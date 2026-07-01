/**
 * liveEval.ts — LIVE-INDEX retrieval strategy eval + reranker benchmark (electron). It runs DAWN's REAL
 * retrieval strategies against the user's actual local index and measures which strategy (and whether GGUF
 * reranking) improves retrieval quality — honestly. It reuses the shipped cores (hybridRank / embeddings /
 * queryExpansion / rerankerCore / rerankerRuntime), never mutates the index, and never persists/logs/export
 * any chunk text, source text, full paths, or model prompt/response — only ids, ranks, providers, numbers,
 * and short user-entered/metadata query strings. Cancellable; leaves no stale reranker jobs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import db from '../db';
import settings from '../settings';
import logger from '../logger';
import embeddings from '../embeddings';
import runtime from '../runtime';
import helperRuntime from './helperRuntime';
import hybridCore from './hybridRetrievalCore';
import reranker from './reranker';
import rerankerRuntime from './rerankerRuntime';
import queryExpansion from './queryExpansion';
import adaptiveRouting from './adaptiveRouting';
import core, { StrategySpec, StrategyQueryRow, BenchInput, SafeChunkMeta } from './liveEvalCore';
import preflightCore, { PreflightSignals } from './livePreflightCore';

const liveResultsPath = () => path.join(app.getPath('userData'), 'rag-live-eval-results.json');
const benchResultsPath = () => path.join(app.getPath('userData'), 'rag-reranker-benchmark.json');
const goldenPath = () => path.join(app.getPath('userData'), 'rag-eval-golden.json');
const GOLDEN_CAP = 200;

type QuerySetMode = 'user' | 'metadata' | 'golden';
interface EvalQuery { query: string; expectedSourceIds: string[]; expectedChunkIds: string[]; label?: string }
interface CandRow { id: string; sourceId: string; name: string; content: string; embedding: any; stale: boolean }

let runToken = 0;         // incremented on each run; a newer run / clear supersedes an older one
let running = false;

// --- safe index signals + preflight -----------------------------------------

function num(sql: string, params: any[] = []): number { try { return db.get<{ c: number }>(sql, params)!.c || 0; } catch { return 0; } }

function gatherSignals(): PreflightSignals {
  const s: any = settings.get();
  const sourceCount = num('SELECT COUNT(*) c FROM knowledge_sources');
  const availableSourceCount = num("SELECT COUNT(*) c FROM knowledge_sources WHERE state IS NULL OR state IN ('indexed','stale')");
  const excludedSourceCount = num("SELECT COUNT(*) c FROM knowledge_sources WHERE state IN ('skipped','removed','failed')");
  const chunkCount = num("SELECT COUNT(*) c FROM knowledge_chunks c LEFT JOIN knowledge_sources ks ON ks.id=c.source_id WHERE ks.state IS NULL OR ks.state IN ('indexed','stale')");
  const embeddedChunkCount = num("SELECT COUNT(*) c FROM knowledge_chunks c LEFT JOIN knowledge_sources ks ON ks.id=c.source_id WHERE (ks.state IS NULL OR ks.state IN ('indexed','stale')) AND c.embedding IS NOT NULL");
  const dist: Record<string, number> = {};
  try {
    for (const r of db.all<any>("SELECT COALESCE(chunk_strategy,'legacy') v, COUNT(*) c FROM knowledge_sources WHERE state IS NULL OR state IN ('indexed','stale') GROUP BY chunk_strategy")) dist[r.v] = r.c;
  } catch { /* */ }
  let outdated = 0; try { outdated = require('../rag').default.reindexInfo().needReindex || 0; } catch { /* */ }

  const ps = (() => { try { return reranker.providerStatus(embeddedChunkCount > 0); } catch { return null; } })();
  return {
    sourceCount, availableSourceCount, excludedSourceCount, chunkCount, embeddedChunkCount,
    chunkStrategyDistribution: dist, outdatedSourceCount: outdated,
    embedModelSummary: String(s.embedModel || ''),
    rerankerReady: (() => { try { return rerankerRuntime.isReady(); } catch { return false; } })(),
    rerankerProvider: ps ? ps.id : 'embedding_similarity',
    rerankerUnavailableReason: ps ? ps.unavailableReason : 'none',
    helperRuntimeReady: (() => { try { return helperRuntime.isReady(); } catch { return false; } })(),
    chatReady: (() => { try { return runtime.isReady(); } catch { return false; } })(),
    preferChatFallback: s.helperModels?.preferChatModelFallback !== false,
    adaptiveEnabled: (() => { try { return adaptiveRouting.enabled(); } catch { return false; } })(),
  };
}

export function preflightLive() {
  const sig = gatherSignals();
  return { timestamp: Date.now(), appVersion: safeVersion(), ...preflightCore.preflight(sig) };
}

function safeVersion(): string { try { return app.getVersion(); } catch { return ''; } }

// --- query sets --------------------------------------------------------------

function loadCandidates(): CandRow[] {
  const rows = db.all<any>(
    `SELECT c.id, c.source_id, c.name, c.content, c.embedding, ks.state AS src_state
     FROM knowledge_chunks c LEFT JOIN knowledge_sources ks ON ks.id = c.source_id
     WHERE ks.state IS NULL OR ks.state IN ('indexed','stale')`
  );
  return rows.map((r) => ({ id: String(r.id), sourceId: String(r.source_id || ''), name: String(r.name || ''), content: String(r.content || ''), embedding: r.embedding, stale: r.src_state === 'stale' }));
}

function buildQuerySet(mode: QuerySetMode, userQueries: any[], max: number): EvalQuery[] {
  if (mode === 'user') {
    return (userQueries || []).filter((q) => q && String(q.query || '').trim()).slice(0, max).map((q) => ({
      query: String(q.query).trim().slice(0, 300),
      expectedSourceIds: Array.isArray(q.expectedSourceIds) ? q.expectedSourceIds.map((x: any) => String(x)).slice(0, 10) : (q.expectedSourceId ? [String(q.expectedSourceId)] : []),
      expectedChunkIds: Array.isArray(q.expectedChunkIds) ? q.expectedChunkIds.map((x: any) => String(x)).slice(0, 10) : (q.expectedChunkId ? [String(q.expectedChunkId)] : []),
      label: 'user',
    }));
  }
  if (mode === 'golden') {
    return listGoldenItems().slice(0, max).map((g) => ({
      query: g.query, expectedSourceIds: g.expectedSourceId ? [g.expectedSourceId] : [], expectedChunkIds: g.expectedChunkId ? [g.expectedChunkId] : [], label: 'golden',
    }));
  }
  // metadata: build from SAFE chunk metadata only (never chunk text)
  let rows: any[] = [];
  try {
    rows = db.all<any>(
      `SELECT c.id, c.source_id, c.name, c.chunk_title, c.parent_heading, c.section_path
       FROM knowledge_chunks c LEFT JOIN knowledge_sources ks ON ks.id = c.source_id
       WHERE ks.state IS NULL OR ks.state IN ('indexed','stale') LIMIT 2000`
    );
  } catch { rows = []; }
  const meta: SafeChunkMeta[] = rows.map((r) => ({ chunkId: String(r.id), sourceId: String(r.source_id || ''), name: r.name, chunkTitle: r.chunk_title, parentHeading: r.parent_heading, sectionPath: r.section_path }));
  return core.metadataQueries(meta, { max }).map((g) => ({ query: g.query, expectedSourceIds: g.expectedSourceIds, expectedChunkIds: g.expectedChunkIds, label: 'metadata' }));
}

// --- per-query strategy execution -------------------------------------------

interface QueryCtx {
  rewrite: any; hyde: any;
  vsPlain: Map<string, number> | null; vsHyde: Map<string, number> | null;
  cands: CandRow[];
}

function cosMap(cands: CandRow[], qv: Float32Array | null): Map<string, number> | null {
  if (!qv) return null;
  const m = new Map<string, number>();
  for (const c of cands) { if (!c.embedding) continue; const v = db.decodeVec(c.embedding); if (v) m.set(c.id, embeddings.cosine(qv, v)); }
  return m;
}

async function buildCtx(query: string, cands: CandRow[], embOk: boolean, needRewrite: boolean, needHyde: boolean): Promise<QueryCtx> {
  const rewrite = needRewrite ? await queryExpansion.rewriteForEval(query).catch(() => null) : null;
  const hyde = needHyde ? await queryExpansion.hydeForEval(query).catch(() => null) : null;
  let vsPlain: Map<string, number> | null = null, vsHyde: Map<string, number> | null = null;
  if (embOk) {
    const qvPlain = await embeddings.embed(query).catch(() => null);
    vsPlain = cosMap(cands, qvPlain);
    if (hyde && hyde.text) { const qvHyde = await embeddings.embed(`${query} ${hyde.text}`).catch(() => null); vsHyde = cosMap(cands, qvHyde); }
    else vsHyde = vsPlain;
  }
  return { rewrite, hyde, vsPlain, vsHyde, cands };
}

const TOPK_INPUT = () => { const n = Number(settings.get().reranker?.gguf?.topKInput); return n > 0 ? n : 30; };
const TOPK_OUTPUT = () => { const n = Number(settings.get().reranker?.gguf?.topKOutput); return n > 0 ? n : 8; };

/** Rank candidate ids for one (strategy, query). Returns SAFE ids only + provider/fallback metadata. */
async function runStrategyForQuery(spec: StrategySpec, q: EvalQuery, ctx: QueryCtx): Promise<StrategyQueryRow> {
  const topKInput = TOPK_INPUT(), topKOutput = TOPK_OUTPUT();
  const expected = [...q.expectedChunkIds, ...q.expectedSourceIds];
  const t0 = Date.now();
  const rowBase = { strategy: spec.id, topKInput, topKOutput, expected };
  try {
    const vsMap = spec.hyde ? ctx.vsHyde : ctx.vsPlain;
    const keywordQuery = spec.rewrite && ctx.rewrite && ctx.rewrite.queries?.length ? ctx.rewrite.queries.join(' ') : q.query;
    const helperFallbackUsed = spec.rewrite ? (ctx.rewrite?.provider === 'chat' ? 'chat' : null) : spec.hyde ? (ctx.hyde?.provider === 'chat' ? 'chat' : null) : null;

    // --- base retrieval ---
    let baseIds: string[] = [];
    if (spec.base === 'vector') {
      if (!vsMap || !vsMap.size) return { ...rowBase, status: 'unavailable', unavailableReason: 'no embeddings', latencyMs: Date.now() - t0, resultIds: [], helperFallbackUsed, rerankerFallbackUsed: null };
      baseIds = [...vsMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, topKInput).map(([id]) => id);
    } else if (spec.base === 'hybrid') {
      const cands = ctx.cands.map((c) => ({ id: c.id, name: c.name, text: c.content, vectorScore: vsMap ? (vsMap.get(c.id) ?? null) : null, stale: c.stale }));
      baseIds = hybridCore.hybridRank(cands, keywordQuery, { topK: topKInput }).results.map((r) => r.id);
    } else { // keyword
      const cands = ctx.cands.map((c) => ({ id: c.id, name: c.name, text: c.content, vectorScore: null, stale: c.stale }));
      baseIds = hybridCore.hybridRank(cands, keywordQuery, { topK: topKInput }).results.map((r) => r.id);
    }

    // --- rerank ---
    let finalIds = baseIds;
    let provider: string = spec.rerank === 'none' ? spec.base : '';
    let rerankerFallbackUsed: string | null = null;
    const embeddingReorder = (ids: string[]) => vsMap ? ids.slice().sort((a, b) => (vsMap.get(b) ?? -1) - (vsMap.get(a) ?? -1)) : ids;

    if (spec.rerank === 'embedding') {
      if (!vsMap || !vsMap.size) return { ...rowBase, status: 'unavailable', unavailableReason: 'embedding rerank needs embeddings', latencyMs: Date.now() - t0, resultIds: [], helperFallbackUsed, rerankerFallbackUsed: null };
      finalIds = embeddingReorder(baseIds); provider = 'embedding_similarity';
    } else if (spec.rerank === 'gguf' || spec.rerank === 'auto') {
      const wantGguf = spec.rerank === 'gguf' || (spec.rerank === 'auto');
      if (wantGguf && rerankerRuntime.isReady()) {
        const head = baseIds.slice(0, topKInput);
        const byId = new Map(ctx.cands.map((c) => [c.id, c] as const));
        const rr = await rerankerRuntime.rerank(q.query, head.map((id) => ({ id, text: byId.get(id)?.content || '' })), { generation: rerankerRuntime.beginGeneration() });
        if (rr.ok && rr.scores) {
          const provCore = require('./rerankerProviderCore').default;
          finalIds = provCore.applyRerank(rr.ids, rr.scores).map((a: any) => a.id);
          provider = 'gguf_reranker';
        } else if (rr.timeout) {
          // honest: GGUF timed out → embedding fallback for the row; benchmark tracks the real timeout
          finalIds = vsMap ? embeddingReorder(baseIds) : baseIds; provider = 'embedding_similarity'; rerankerFallbackUsed = 'embedding_similarity';
          return { ...rowBase, status: 'timed_out', unavailableReason: 'GGUF reranker timed out', provider, helperFallbackUsed, rerankerFallbackUsed, latencyMs: Date.now() - t0, resultIds: finalIds.slice(0, topKOutput) };
        } else {
          finalIds = vsMap ? embeddingReorder(baseIds) : baseIds; provider = 'embedding_similarity'; rerankerFallbackUsed = 'embedding_similarity';
        }
      } else if (spec.rerank === 'auto' && vsMap && vsMap.size) {
        finalIds = embeddingReorder(baseIds); provider = 'embedding_similarity'; rerankerFallbackUsed = 'embedding_similarity';
      } else {
        return { ...rowBase, status: 'unavailable', unavailableReason: `GGUF reranker unavailable`, latencyMs: Date.now() - t0, resultIds: [], helperFallbackUsed, rerankerFallbackUsed: null };
      }
    }

    return { ...rowBase, status: 'ran', provider, helperFallbackUsed, rerankerFallbackUsed, latencyMs: Date.now() - t0, resultIds: finalIds.slice(0, topKOutput) };
  } catch (e: any) {
    return { ...rowBase, status: 'failed', unavailableReason: String(e?.message || 'error').slice(0, 80), latencyMs: Date.now() - t0, resultIds: [], helperFallbackUsed: null, rerankerFallbackUsed: null };
  }
}

// --- live strategy eval ------------------------------------------------------

export async function runLive(opts: { querySetMode?: QuerySetMode; queries?: any[]; maxQueries?: number } = {}): Promise<any> {
  if (running) return { ok: false, error: 'An eval is already running.' };
  const pre = preflightLive();
  if (!pre.canRunLive) return { ok: false, error: pre.canRunReason, preflight: pre };
  running = true; const myToken = ++runToken;
  try {
    const mode: QuerySetMode = opts.querySetMode || 'metadata';
    const max = Math.min(Math.max(1, opts.maxQueries || 20), 100);
    const queries = buildQuerySet(mode, opts.queries || [], max);
    if (!queries.length) { return { ok: false, error: `No eval queries (${mode} set is empty).`, preflight: pre }; }
    const cands = loadCandidates();
    const topK = TOPK_OUTPUT();
    const eligible = pre.strategies.filter((s) => s.eligible);
    const eligIds = new Set(eligible.map((s) => s.strategy));
    const specs = core.STRATEGY_SPECS.filter((s) => eligIds.has(s.id));
    const needRewrite = specs.some((s) => s.rewrite);
    const needHyde = specs.some((s) => s.hyde);
    const embOk = pre.index.embeddingsAvailable;

    const rowsByStrategy = new Map<string, StrategyQueryRow[]>();
    for (const s of core.STRATEGY_SPECS) rowsByStrategy.set(s.id, []);
    const perQuery: any[] = [];

    for (const q of queries) {
      if (myToken !== runToken) return { ok: false, error: 'Eval cancelled.' }; // superseded/cancelled
      const ctx = await buildCtx(q.query, cands, embOk, needRewrite, needHyde);
      const qRow: any = { query: q.query, label: q.label, expectedSourceIds: q.expectedSourceIds, expectedChunkIds: q.expectedChunkIds, perStrategy: [] as any[] };
      for (const spec of core.STRATEGY_SPECS) {
        if (!eligIds.has(spec.id)) {
          const reason = pre.strategies.find((s) => s.strategy === spec.id)?.reason || 'unavailable';
          rowsByStrategy.get(spec.id)!.push({ strategy: spec.id, status: 'unavailable', unavailableReason: reason, topKInput: TOPK_INPUT(), topKOutput: topK, latencyMs: 0, resultIds: [], expected: [...q.expectedChunkIds, ...q.expectedSourceIds] });
          continue;
        }
        const row = await runStrategyForQuery(spec, q, ctx);
        rowsByStrategy.get(spec.id)!.push(row);
        const exp = [...q.expectedChunkIds, ...q.expectedSourceIds];
        qRow.perStrategy.push({ strategy: spec.id, status: row.status, provider: row.provider, expectedRank: core.rankOfExpected(row.resultIds, exp), resultIds: row.resultIds.slice(0, topK), latencyMs: row.latencyMs, helperFallbackUsed: row.helperFallbackUsed, rerankerFallbackUsed: row.rerankerFallbackUsed });
      }
      perQuery.push(qRow);
    }

    const aggs = core.STRATEGY_SPECS.map((s) => core.aggregateStrategy(s, rowsByStrategy.get(s.id)!, topK));
    const summary = core.summarizeLive(aggs, queries.length);
    const result = {
      ok: true, evalMode: 'live_index_eval', timestamp: Date.now(), appVersion: safeVersion(),
      querySetMode: mode, topKInput: TOPK_INPUT(), topKOutput: topK,
      index: pre.index, providers: pre.providers, summary,
      unavailableReasons: pre.strategies.filter((s) => !s.eligible).map((s) => ({ strategy: s.strategy, reason: s.reason })),
      queries: perQuery,
    };
    try { fs.writeFileSync(liveResultsPath(), JSON.stringify(result, null, 2)); } catch { /* */ }
    logger.info('rag', `live eval: ${summary.ranStrategies} strategies ran over ${queries.length} queries (best: ${summary.best || summary.bestQualifier})`);
    return result;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  } finally { running = false; try { rerankerRuntime.cancelJobs(); } catch { /* */ } }
}

// --- reranker benchmark ------------------------------------------------------

export async function runRerankerBenchmark(opts: { querySetMode?: QuerySetMode; queries?: any[]; maxQueries?: number } = {}): Promise<any> {
  if (running) return { ok: false, error: 'An eval is already running.' };
  const pre = preflightLive();
  if (!pre.canRunLive) return { ok: false, error: pre.canRunReason, preflight: pre };
  if (!pre.index.embeddingsAvailable) return { ok: false, error: 'Reranker benchmark needs embeddings (baseline hybrid + embedding rerank).', preflight: pre };
  running = true; const myToken = ++runToken;
  try {
    const mode: QuerySetMode = opts.querySetMode || 'metadata';
    const max = Math.min(Math.max(1, opts.maxQueries || 20), 100);
    const queries = buildQuerySet(mode, opts.queries || [], max);
    if (!queries.length) return { ok: false, error: `No eval queries (${mode} set is empty).`, preflight: pre };
    const cands = loadCandidates();
    const topKInput = TOPK_INPUT();
    const ggufReady = rerankerRuntime.isReady();
    const ggufReason = pre.providers.reranker.ready ? undefined : `GGUF reranker unavailable (${pre.providers.reranker.unavailableReason || 'not ready'})`;
    const inputs: BenchInput[] = [];
    const perQuery: any[] = [];

    for (const q of queries) {
      if (myToken !== runToken) return { ok: false, error: 'Eval cancelled.' };
      const expected = [...q.expectedChunkIds, ...q.expectedSourceIds];
      const qvPlain = await embeddings.embed(q.query).catch(() => null);
      const vsMap = cosMap(cands, qvPlain) || new Map<string, number>();
      // Same baseline candidate set for all three orders: hybrid over the top candidates.
      const hybridCands = cands.map((c) => ({ id: c.id, name: c.name, text: c.content, vectorScore: vsMap.get(c.id) ?? null, stale: c.stale }));
      const baselineIds = hybridCore.hybridRank(hybridCands, q.query, { topK: topKInput }).results.map((r) => r.id);
      const embeddingIds = baselineIds.slice().sort((a, b) => (vsMap.get(b) ?? -1) - (vsMap.get(a) ?? -1));

      let ggufIds: string[] | null = null; let ggufStatus: BenchInput['ggufStatus'] = 'unavailable'; let ggufLatencyMs: number | null = null; let ggufFallbackUsed: string | null = null;
      if (ggufReady) {
        const byId = new Map(cands.map((c) => [c.id, c] as const));
        const t0 = Date.now();
        const rr = await rerankerRuntime.rerank(q.query, baselineIds.slice(0, topKInput).map((id) => ({ id, text: byId.get(id)?.content || '' })), { generation: rerankerRuntime.beginGeneration() });
        ggufLatencyMs = Date.now() - t0;
        if (rr.ok && rr.scores) { const provCore = require('./rerankerProviderCore').default; ggufIds = provCore.applyRerank(rr.ids, rr.scores).map((a: any) => a.id); ggufStatus = 'ran'; }
        else if (rr.timeout) { ggufStatus = 'timed_out'; ggufFallbackUsed = 'embedding_similarity'; }
        else { ggufStatus = 'failed'; ggufFallbackUsed = 'embedding_similarity'; }
      }

      inputs.push({ expected, baselineIds, embeddingIds, ggufIds, ggufStatus, ggufUnavailableReason: ggufReady ? undefined : ggufReason, ggufFallbackUsed, embeddingLatencyMs: 0, ggufLatencyMs });
      perQuery.push({
        query: q.query, label: q.label,
        baselineRank: core.rankOfExpected(baselineIds, expected), embeddingRank: core.rankOfExpected(embeddingIds, expected),
        ggufRank: ggufIds ? core.rankOfExpected(ggufIds, expected) : null,
        movementEmbedding: core.movement(core.rankOfExpected(baselineIds, expected), core.rankOfExpected(embeddingIds, expected)),
        movementGguf: ggufIds ? core.movement(core.rankOfExpected(baselineIds, expected), core.rankOfExpected(ggufIds, expected)) : 'n/a',
        ggufStatus,
      });
    }

    const summary = core.summarizeBenchmark(inputs, TOPK_OUTPUT());
    const result = {
      ok: true, evalMode: 'reranker_benchmark', timestamp: Date.now(), appVersion: safeVersion(),
      querySetMode: mode, topKInput, topKOutput: TOPK_OUTPUT(),
      index: pre.index, providers: pre.providers, ggufReady, ggufUnavailableReason: ggufReady ? null : (pre.providers.reranker.unavailableReason || 'not ready'),
      summary, queries: perQuery,
    };
    try { fs.writeFileSync(benchResultsPath(), JSON.stringify(result, null, 2)); } catch { /* */ }
    logger.info('rag', `reranker benchmark: ${queries.length} queries, GGUF ${summary.ggufRanCount} ran / ${summary.ggufUnavailableCount} unavailable / ${summary.ggufTimeoutCount} timeout (lift: ${summary.ggufLift})`);
    return result;
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  } finally { running = false; try { rerankerRuntime.cancelJobs(); } catch { /* */ } }
}

// --- persistence + golden set ------------------------------------------------

export function status() {
  const read = (p: string) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } };
  return { live: read(liveResultsPath()), benchmark: read(benchResultsPath()), goldenCount: listGoldenItems().length, running };
}

export function listGoldenItems(): any[] {
  try { const j = JSON.parse(fs.readFileSync(goldenPath(), 'utf8')); return Array.isArray(j.items) ? j.items : []; } catch { return []; }
}
export function saveGoldenItem(input: any) {
  const item = core.sanitizeGoldenItem(input, Date.now(), () => randomUUID());
  if (!item) return { ok: false, error: 'A golden item needs a query.' };
  const items = listGoldenItems().filter((i) => i.id !== item.id);
  items.push(item);
  const bounded = items.slice(-GOLDEN_CAP);
  try { fs.writeFileSync(goldenPath(), JSON.stringify({ items: bounded }, null, 2)); } catch { /* */ }
  return { ok: true, items: bounded };
}
export function deleteGoldenItem(id: string) {
  const items = listGoldenItems().filter((i) => i.id !== String(id));
  try { fs.writeFileSync(goldenPath(), JSON.stringify({ items }, null, 2)); } catch { /* */ }
  return { ok: true, items };
}

/** A fully SAFE combined export object (ids + numbers + metadata queries only — no chunk/source/model text). */
export function safeExport() {
  const st = status();
  let offline: any = null; try { offline = require('./ragEval').default.status(); } catch { /* */ }
  return { schema: 'dawn-eval-export-v1', exportedAt: Date.now(), appVersion: safeVersion(), offline: offline?.summary || null, offlineStrategies: offline?.strategies || null, live: st.live, benchmark: st.benchmark, golden: listGoldenItems() };
}

export function clearLive() {
  runToken++; // supersede any in-flight run
  try { rerankerRuntime.cancelJobs(); } catch { /* */ }
  for (const p of [liveResultsPath(), benchResultsPath()]) { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* */ } }
  return { ok: true };
}

export default {
  preflightLive, runLive, runRerankerBenchmark, status,
  listGoldenItems, saveGoldenItem, deleteGoldenItem, safeExport, clearLive,
};
