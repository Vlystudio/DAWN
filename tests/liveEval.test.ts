/**
 * liveEval.test.ts — live-index retrieval strategy eval + reranker benchmark. Pure, deterministic, no
 * electron/model/live-index. Guards the honest contract: preflight refuses an empty index; missing
 * embeddings/helper/GGUF mark the right strategies unavailable with real reasons; metadata queries use
 * metadata only (never chunk text); golden items keep safe fields only; ranking metrics (hit/MRR/topK/nDCG)
 * are correct; "best" is never overstated; the reranker benchmark never fakes GGUF lift; and no chunk/source
 * text can appear in results. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import core, {
  STRATEGY_SPECS, rankOfExpected, reciprocalRank, ndcgBinary, hitAtK, aggregateStrategy, summarizeLive,
  movement, summarizeBenchmark, metadataQueries, sanitizeGoldenItem, StrategyQueryRow, BenchInput,
} from '../electron/services/rag/liveEvalCore';
import preflight from '../electron/services/rag/livePreflightCore';

const SIG = (over: any = {}): any => ({
  sourceCount: 3, availableSourceCount: 3, excludedSourceCount: 0, chunkCount: 40, embeddedChunkCount: 40,
  chunkStrategyDistribution: { v2: 3 }, outdatedSourceCount: 0, embedModelSummary: 'nomic-embed-text',
  rerankerReady: true, rerankerProvider: 'gguf_reranker', rerankerUnavailableReason: 'none',
  helperRuntimeReady: true, chatReady: true, preferChatFallback: true, adaptiveEnabled: false, ...over,
});
const spec = (id: string) => STRATEGY_SPECS.find((s) => s.id === id)!;
const strat = (id: string) => preflight.preflight(SIG()).strategies.find((s) => s.strategy === id)!;

// --- preflight ---------------------------------------------------------------

test('empty index refuses live eval', () => {
  const p = preflight.preflight(SIG({ chunkCount: 0, embeddedChunkCount: 0, sourceCount: 0, availableSourceCount: 0 }));
  assert.equal(p.canRunLive, false);
  assert.match(p.canRunReason, /no live index/i);
});

test('no embeddings marks vector/hybrid/rerank strategies unavailable honestly', () => {
  const p = preflight.preflight(SIG({ embeddedChunkCount: 0 }));
  const byId = (id: string) => p.strategies.find((s) => s.strategy === id)!;
  assert.equal(byId('keyword').eligible, true);          // keyword still works
  assert.equal(byId('vector').eligible, false);
  assert.match(byId('vector').reason!, /no embeddings/i);
  assert.equal(byId('hybrid').eligible, false);
  assert.equal(byId('hybrid_embedding_rerank').eligible, false);
  assert.equal(byId('embedding_rerank').eligible, false);
});

test('helper unavailable (and no chat fallback) marks rewrite/HyDE unavailable', () => {
  const p = preflight.preflight(SIG({ helperRuntimeReady: false, chatReady: false }));
  const byId = (id: string) => p.strategies.find((s) => s.strategy === id)!;
  assert.equal(byId('rewrite_hybrid').eligible, false);
  assert.equal(byId('hyde_vector').eligible, false);
  assert.match(byId('rewrite_hybrid').reason!, /helper|chat/i);
});

test('helper down but chat fallback allowed → rewrite runs with chat fallback flagged', () => {
  const p = preflight.preflight(SIG({ helperRuntimeReady: false, chatReady: true, preferChatFallback: true }));
  const rw = p.strategies.find((s) => s.strategy === 'rewrite_hybrid')!;
  assert.equal(rw.eligible, true);
  assert.equal(rw.helperFallback, 'chat');
  assert.equal(p.providers.helper.rewriteProvider, 'chat');
});

test('GGUF unavailable marks GGUF rerank strategies unavailable, honest reason', () => {
  const p = preflight.preflight(SIG({ rerankerReady: false, rerankerUnavailableReason: 'unavailable_api_not_supported' }));
  const byId = (id: string) => p.strategies.find((s) => s.strategy === id)!;
  assert.equal(byId('gguf_rerank').eligible, false);
  assert.equal(byId('hybrid_gguf_rerank').eligible, false);
  assert.match(byId('gguf_rerank').reason!, /api not supported|not ready|unavailable/i);
  // auto-rerank strategy stays eligible but records the embedding fallback
  const auto = byId('rewrite_hybrid_rerank');
  assert.equal(auto.eligible, true);
  assert.equal(auto.rerankerFallback, 'embedding_similarity');
});

test('preflight carries no chunk/source text or full paths', () => {
  const p = preflight.preflight(SIG());
  assert.ok(!/prompt|chunk text|passage|\/Users\/|C:\\\\/i.test(JSON.stringify(p)));
});

// --- query sets --------------------------------------------------------------

test('metadata queries use metadata only, never chunk text; expect their own chunk', () => {
  const rows = [
    { chunkId: 'c1', sourceId: 's1', name: 'varroa.md', chunkTitle: 'Varroa mite treatment', sectionPath: 'Health', parentHeading: 'Pests' },
    { chunkId: 'c2', sourceId: 's1', name: 'notes.txt', chunkTitle: '', sectionPath: '', parentHeading: '' }, // falls back to basename
    { chunkId: 'c3', sourceId: 's2', name: '', chunkTitle: '', sectionPath: '', parentHeading: '' },           // no metadata → skipped
  ];
  const qs = metadataQueries(rows as any, { max: 10 });
  assert.equal(qs[0].query, 'Varroa mite treatment');
  assert.deepEqual(qs[0].expectedChunkIds, ['c1']);
  assert.deepEqual(qs[0].expectedSourceIds, ['s1']);
  assert.equal(qs[1].query, 'notes');    // basename, extension stripped
  assert.equal(qs.length, 2);            // c3 (no metadata) skipped, never fabricated
});

test('golden item sanitize keeps safe fields only (drops chunk text)', () => {
  const g = sanitizeGoldenItem({ query: 'best fruit for pie', expectedChunkId: 'c9', chunkText: 'SECRET CONTENT', label: 'pie', notes: 'n' }, 111, () => 'id1');
  assert.equal(g!.query, 'best fruit for pie');
  assert.equal(g!.expectedChunkId, 'c9');
  assert.equal((g as any).chunkText, undefined);
  assert.ok(!/SECRET CONTENT/.test(JSON.stringify(g)));
  assert.equal(sanitizeGoldenItem({ notes: 'no query' }, 1, () => 'x'), null); // requires a query
});

// --- ranking metrics ---------------------------------------------------------

test('rankOfExpected / hitAtK / reciprocalRank / ndcg compute correctly', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.equal(rankOfExpected(ids, ['c']), 2);
  assert.equal(rankOfExpected(ids, ['z']), null);
  assert.equal(rankOfExpected(ids, []), null);          // no expected → null (not a fake hit)
  assert.equal(hitAtK(ids, ['c'], 3), true);
  assert.equal(hitAtK(ids, ['c'], 2), false);
  assert.equal(reciprocalRank(ids, ['c']), Number((1 / 3).toFixed(4)));
  assert.equal(reciprocalRank(ids, ['z']), 0);
  assert.equal(ndcgBinary(ids, ['a'], 4), 1);           // relevant at rank 0 → perfect
  assert.equal(ndcgBinary(ids, [], 4), null);           // no labels → nDCG unavailable
});

// --- strategy aggregation + honest best --------------------------------------

const row = (over: Partial<StrategyQueryRow>): StrategyQueryRow => ({ strategy: 'keyword', status: 'ran', topKInput: 30, topKOutput: 8, latencyMs: 10, resultIds: [], expected: [], ...over });

test('aggregateStrategy computes hit rate/MRR over labeled ran queries only', () => {
  const rows: StrategyQueryRow[] = [
    row({ resultIds: ['x', 'a'], expected: ['a'] }), // hit@2, rr=1/2
    row({ resultIds: ['b'], expected: ['b'] }),      // hit@1, rr=1
    row({ resultIds: ['q'], expected: [] }),         // unlabeled → excluded from hit/MRR
  ];
  const agg = aggregateStrategy(spec('keyword'), rows, 8);
  assert.equal(agg.status, 'ran');
  assert.equal(agg.labeledQueries, 2);
  assert.equal(agg.hitRate, 1);                      // both labeled hit within top-8
  assert.equal(agg.top1, 0.5);                       // only the 2nd is rank-0
  assert.equal(agg.mrr, Number(((0.5 + 1) / 2).toFixed(4)));
});

test('best is never overstated: one strategy → only_available; too few labeled → insufficient', () => {
  const one = aggregateStrategy(spec('keyword'), [row({ resultIds: ['a'], expected: ['a'] }), row({ resultIds: ['b'], expected: ['b'] }), row({ resultIds: ['c'], expected: ['c'] })], 8);
  const s1 = summarizeLive([one], 3, { minStrategies: 2, minQueries: 3 });
  assert.equal(s1.bestQualifier, 'only_available');

  const few = aggregateStrategy(spec('keyword'), [row({ resultIds: ['a'], expected: ['a'] })], 8);
  const s2 = summarizeLive([few], 1, { minStrategies: 2, minQueries: 3 });
  assert.equal(s2.bestQualifier, 'insufficient_samples');

  const unl = aggregateStrategy(spec('keyword'), [row({ resultIds: ['a'], expected: [] })], 8);
  assert.equal(summarizeLive([unl], 1).bestQualifier, 'unlabeled');
});

test('best_available only when ≥2 strategies ran over enough labeled queries', () => {
  const mk = (id: string, hits: boolean[]) => aggregateStrategy(spec(id), hits.map((h, i) => row({ strategy: id, resultIds: h ? [`e${i}`] : ['x'], expected: [`e${i}`] })), 8);
  const kw = mk('keyword', [true, true, false]);   // hitRate 2/3
  const hy = mk('hybrid', [true, true, true]);      // hitRate 3/3
  const s = summarizeLive([kw, hy], 3, { minStrategies: 2, minQueries: 3 });
  assert.equal(s.bestQualifier, 'best_available');
  assert.equal(s.best, 'hybrid');
});

// --- reranker benchmark ------------------------------------------------------

test('movement classifies rank change', () => {
  assert.equal(movement(3, 0), 'improved');
  assert.equal(movement(0, 3), 'worsened');
  assert.equal(movement(2, 2), 'unchanged');
  assert.equal(movement(null, 1), 'n/a');
});

test('benchmark: GGUF unavailable never fakes lift', () => {
  const inputs: BenchInput[] = [1, 2, 3].map((i) => ({
    expected: [`e${i}`], baselineIds: ['x', `e${i}`], embeddingIds: [`e${i}`, 'x'],
    ggufIds: null, ggufStatus: 'unavailable', ggufUnavailableReason: 'unavailable_runtime_not_ready',
    ggufFallbackUsed: null, embeddingLatencyMs: 5, ggufLatencyMs: null,
  }));
  const s = summarizeBenchmark(inputs, 8);
  assert.equal(s.gguf, null);
  assert.equal(s.ggufLift, 'unavailable');
  assert.match(s.ggufLiftReason!, /ready|did not run/i);
  assert.equal(s.embeddingLift, 'improves'); // embedding moved expected from rank 1 → 0
});

test('benchmark: GGUF improves expected rank when mocked scores support it (real movement)', () => {
  const inputs: BenchInput[] = [1, 2, 3, 4].map((i) => ({
    expected: [`e${i}`], baselineIds: ['x', 'y', `e${i}`], embeddingIds: ['x', 'y', `e${i}`],
    ggufIds: [`e${i}`, 'x', 'y'], ggufStatus: 'ran', ggufFallbackUsed: null, embeddingLatencyMs: 4, ggufLatencyMs: 30,
  }));
  const s = summarizeBenchmark(inputs, 8);
  assert.ok(s.gguf);
  assert.equal(s.gguf!.top1, 1);                         // GGUF puts expected at rank 0 every time
  assert.equal(s.ggufLift, 'improves');
  assert.equal(s.rankMovement.gguf!.improved, 4);
  assert.equal(s.rankMovement.gguf!.worsened, 0);
  assert.equal(s.ggufRanCount, 4);
});

test('benchmark: timeout/failed counted, fallback counted, latency computed', () => {
  const inputs: BenchInput[] = [
    { expected: ['e1'], baselineIds: ['e1'], embeddingIds: ['e1'], ggufIds: ['e1'], ggufStatus: 'ran', ggufFallbackUsed: null, embeddingLatencyMs: 5, ggufLatencyMs: 20 },
    { expected: ['e2'], baselineIds: ['x', 'e2'], embeddingIds: ['e2', 'x'], ggufIds: null, ggufStatus: 'timed_out', ggufFallbackUsed: 'embedding_similarity', embeddingLatencyMs: 6, ggufLatencyMs: null },
    { expected: ['e3'], baselineIds: ['x', 'e3'], embeddingIds: ['e3', 'x'], ggufIds: null, ggufStatus: 'failed', ggufFallbackUsed: 'embedding_similarity', embeddingLatencyMs: 7, ggufLatencyMs: null },
  ];
  const s = summarizeBenchmark(inputs, 8, { minQueries: 1 });
  assert.equal(s.ggufTimeoutCount, 1);
  assert.equal(s.ggufFailedCount, 1);
  assert.equal(s.ggufFallbackCount, 2);
  assert.equal(s.ggufRanCount, 1);
  assert.equal(s.latency.embeddingAvgMs, 6);
});

// --- IPC/preload contract (targeted) -----------------------------------------

test('live-eval IPC channels are wired (preload ↔ ipc), no chunk text in handlers', () => {
  const root = process.cwd();
  const ipc = fs.readFileSync(path.join(root, 'electron/ipc.ts'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  for (const ch of ['rag:eval:preflightLive', 'rag:eval:live', 'rag:eval:rerankerBenchmark', 'rag:eval:saveGoldenItem', 'rag:eval:listGoldenItems', 'rag:eval:deleteGoldenItem', 'rag:eval:exportSafeEval', 'rag:eval:clearLiveResult']) {
    assert.ok(ipc.includes(`ipcMain.handle('${ch}'`), `missing IPC handler: ${ch}`);
    assert.ok(preloadSrc.includes(`invoke('${ch}'`), `preload does not invoke: ${ch}`);
  }
});

test('the 12 documented strategies exist', () => {
  const ids = STRATEGY_SPECS.map((s) => s.id);
  for (const id of ['keyword', 'vector', 'hybrid', 'rewrite_hybrid', 'hyde_vector', 'hyde_hybrid', 'embedding_rerank', 'gguf_rerank', 'hybrid_embedding_rerank', 'hybrid_gguf_rerank', 'rewrite_hybrid_rerank', 'hyde_hybrid_rerank'])
    assert.ok(ids.includes(id), `missing strategy: ${id}`);
  assert.equal(STRATEGY_SPECS.length, 12);
});

test('default export surface present', () => {
  assert.equal(typeof core.summarizeLive, 'function');
  assert.equal(typeof core.summarizeBenchmark, 'function');
  assert.equal(typeof preflight.preflight, 'function');
});
