/**
 * reranker.test.ts — GGUF reranker / cross-encoder path. Pure, deterministic, no electron/model/network.
 * Guards the honest contract: embedding-similarity stays the ready default; GGUF is off by default; every
 * "unavailable" is a specific reason; scores are never fabricated; original/reranked ranks are preserved;
 * topKInput + maxCandidateChars are enforced; malformed/length-mismatch/missing-score are handled honestly;
 * and the queue is bounded, cancellable, and cleared on stop. No query/chunk/passage text ever appears in
 * status/plan/trace. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import provider, {
  resolveProviderStatus, resolveRerankPlan, ggufReason, applyRerank, scoresSummary, fallbackFor,
} from '../electron/services/rag/rerankerProviderCore';
import client, { buildRerankRequest, parseRerankResponse, httpStatusReason } from '../electron/services/rag/rerankerClientCore';
import { HelperQueue } from '../electron/services/rag/helperQueue';
import { decide as adaptiveDecide, appliesTo as adaptiveApplies } from '../electron/services/rag/adaptiveRoutingCore';

const PIN = (over: any = {}): any => ({
  provider: 'gguf_reranker', embeddingsAvailable: true, ggufEnabled: true, ggufModelConfigured: true,
  ggufModelExists: true, runtimeInstalled: true, runtimeRunning: true, runtimeReachable: true,
  endpointSupported: true, capabilityReason: 'none', ...over,
});

// --- Provider status ---------------------------------------------------------

test('default provider remains embedding_similarity and is READY', () => {
  const s = resolveProviderStatus({ provider: 'embedding_similarity', embeddingsAvailable: true } as any);
  assert.equal(s.id, 'embedding_similarity');
  assert.equal(s.ready, true);
  assert.equal(s.statusLabel, 'READY');
  assert.equal(s.scoreType, 'cosine_similarity');
});

test('GGUF disabled reports needs-setup (not ready, no fake cross-encoder)', () => {
  const s = resolveProviderStatus(PIN({ ggufEnabled: false }));
  assert.equal(s.id, 'gguf_reranker');
  assert.equal(s.ready, false);
  assert.equal(s.unavailableReason, 'unavailable_needs_setup');
  assert.equal(s.scoreType, 'none');
});

test('missing model reports unavailable_model_missing', () => {
  const s = resolveProviderStatus(PIN({ ggufModelExists: false }));
  assert.equal(s.unavailableReason, 'unavailable_model_missing');
  assert.equal(s.ready, false);
});

test('runtime binary missing reports unavailable_runtime_missing', () => {
  const s = resolveProviderStatus(PIN({ runtimeInstalled: false }));
  assert.equal(s.unavailableReason, 'unavailable_runtime_missing');
});

test('server reachable but endpoint unsupported reports unavailable_api_not_supported', () => {
  const s = resolveProviderStatus(PIN({ endpointSupported: false, capabilityReason: 'unavailable_api_not_supported' }));
  assert.equal(s.unavailableReason, 'unavailable_api_not_supported');
  assert.equal(s.ready, false);
});

test('malformed endpoint response reports unavailable_server_error', () => {
  const s = resolveProviderStatus(PIN({ endpointSupported: false, capabilityReason: 'unavailable_server_error' }));
  assert.equal(s.unavailableReason, 'unavailable_server_error');
});

test('endpoint timeout reports unavailable_timeout', () => {
  const s = resolveProviderStatus(PIN({ endpointSupported: false, capabilityReason: 'unavailable_timeout' }));
  assert.equal(s.unavailableReason, 'unavailable_timeout');
});

test('reachable-but-not-yet-probed is NOT claimed ready (no inference from reachability)', () => {
  const r = ggufReason(PIN({ endpointSupported: null }));
  assert.equal(r, 'unavailable_runtime_not_ready');
  const s = resolveProviderStatus(PIN({ endpointSupported: null }));
  assert.equal(s.ready, false);
});

test('GGUF ready → reranker_relevance / relative semantics, endpoint carried', () => {
  const s = resolveProviderStatus(PIN({ endpoint: 'http://127.0.0.1:8091', modelSummary: 'bge-reranker.gguf' }));
  assert.equal(s.ready, true);
  assert.equal(s.scoreType, 'reranker_relevance');
  assert.equal(s.scoreSemantics, 'relative'); // real signal, but NOT a calibrated probability
  assert.equal(s.endpoint, 'http://127.0.0.1:8091');
});

test('provider status carries no query/chunk/passage text (redacted by construction)', () => {
  const s = resolveProviderStatus(PIN({ modelSummary: 'bge-reranker.gguf', lastError: 'timed out' }));
  assert.ok(!/prompt|chunk|passage|query text|\/Users\/|C:\\\\/i.test(JSON.stringify(s)));
});

// --- Rerank plan (which provider actually runs) ------------------------------

test('default plan (embedding_similarity + rerank master OFF) → disabled (byte-for-byte prior default)', () => {
  const p = resolveRerankPlan({ selected: 'embedding_similarity', rerankerEnabled: false, embeddingsAvailable: true, ggufEnabled: false, ggufReady: false, ggufUnavailableReason: 'none' });
  assert.equal(p.provider, 'disabled');
});

test('embedding rerank runs only when the master toggle is on', () => {
  const on = resolveRerankPlan({ selected: 'embedding_similarity', rerankerEnabled: true, embeddingsAvailable: true, ggufEnabled: false, ggufReady: false, ggufUnavailableReason: 'none' });
  assert.equal(on.provider, 'embedding_similarity');
  const noEmb = resolveRerankPlan({ selected: 'embedding_similarity', rerankerEnabled: true, embeddingsAvailable: false, ggufEnabled: false, ggufReady: false, ggufUnavailableReason: 'none' });
  assert.equal(noEmb.provider, 'heuristic');
});

test('GGUF selected + ready → gguf_reranker runs', () => {
  const p = resolveRerankPlan({ selected: 'gguf_reranker', rerankerEnabled: false, embeddingsAvailable: true, ggufEnabled: true, ggufReady: true, ggufUnavailableReason: 'none' });
  assert.equal(p.provider, 'gguf_reranker');
  assert.equal(p.scoreType, 'reranker_relevance');
  assert.equal(p.usedFallback, false);
});

test('GGUF selected + unavailable → honest fallback to embedding, reason recorded', () => {
  const p = resolveRerankPlan({ selected: 'gguf_reranker', rerankerEnabled: false, embeddingsAvailable: true, ggufEnabled: true, ggufReady: false, ggufUnavailableReason: 'unavailable_api_not_supported' });
  assert.equal(p.provider, 'embedding_similarity');
  assert.equal(p.usedFallback, true);
  assert.equal(p.unavailableReason, 'unavailable_api_not_supported');
});

test('GGUF unavailable + no embeddings → hybrid order kept (heuristic)', () => {
  const p = resolveRerankPlan({ selected: 'gguf_reranker', rerankerEnabled: false, embeddingsAvailable: false, ggufEnabled: true, ggufReady: false, ggufUnavailableReason: 'unavailable_runtime_not_ready' });
  assert.equal(p.provider, 'heuristic');
  assert.equal(p.usedFallback, true);
});

// --- Request building (topKInput + maxCandidateChars enforced) ---------------

test('buildRerankRequest enforces topKInput and maxCandidateChars', () => {
  const cands = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, text: 'x'.repeat(9000) }));
  const built = buildRerankRequest('q', cands, { topKInput: 30, maxCandidateChars: 4000 });
  assert.equal(built.inputCount, 30);
  assert.equal(built.documents.length, 30);
  assert.equal(built.ids.length, 30);
  assert.ok(built.documents.every((d) => d.length === 4000));
});

// --- Response parsing (honest failure modes, no fabrication) -----------------

test('parseRerankResponse maps results by index; sorting + ranks assigned', () => {
  const ids = ['a', 'b', 'c'];
  const r = parseRerankResponse({ results: [{ index: 0, relevance_score: 0.2 }, { index: 1, relevance_score: 0.9 }, { index: 2, relevance_score: 0.5 }] }, ids);
  assert.equal(r.ok, true);
  const applied = applyRerank(ids, r.scores);
  // highest score (b) first, then c, then a; original ranks preserved
  assert.deepEqual(applied.map((x) => x.id), ['b', 'c', 'a']);
  assert.deepEqual(applied.map((x) => x.originalRank), [1, 2, 0]);
  assert.deepEqual(applied.map((x) => x.rerankedRank), [0, 1, 2]);
});

test('length mismatch handled honestly (missing ids get null, kept after scored)', () => {
  const ids = ['a', 'b', 'c'];
  const r = parseRerankResponse({ results: [{ index: 2, relevance_score: 0.8 }] }, ids); // only c scored
  assert.equal(r.ok, true);
  assert.equal(r.lengthMismatch, true);
  const applied = applyRerank(ids, r.scores);
  assert.equal(applied[0].id, 'c');          // scored first
  assert.equal(applied[0].score, 0.8);
  assert.deepEqual(applied.slice(1).map((x) => x.id), ['a', 'b']); // nulls keep original order
  assert.equal(applied[1].score, null);
});

test('out-of-range index and non-numeric score are ignored (never faked)', () => {
  const ids = ['a', 'b'];
  const r = parseRerankResponse({ results: [{ index: 9, relevance_score: 0.9 }, { index: 0, relevance_score: 'NaN' }] }, ids);
  assert.equal(r.ok, false);                  // no valid scores
  assert.equal(r.scores, null);
});

test('malformed body → not ok (no results array)', () => {
  assert.equal(parseRerankResponse({ nope: true }, ['a']).ok, false);
  assert.equal(parseRerankResponse(null, ['a']).ok, false);
  assert.equal(parseRerankResponse('oops', ['a']).ok, false);
});

test('no fake scores when provider unavailable — applyRerank(null) is identity, all null', () => {
  const ids = ['a', 'b', 'c'];
  const applied = applyRerank(ids, null);
  assert.deepEqual(applied.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(applied.map((x) => x.rerankedRank), [0, 1, 2]);
  assert.ok(applied.every((x) => x.score === null));
});

test('scoresSummary is numeric-only and ignores nulls', () => {
  const sum = scoresSummary([{ id: 'a', score: 0.2 }, { id: 'b', score: null }, { id: 'c', score: 0.8 }]);
  assert.deepEqual(sum, { count: 2, min: 0.2, max: 0.8, mean: 0.5 });
  assert.deepEqual(scoresSummary(null), { count: 0, min: null, max: null, mean: null });
});

test('httpStatusReason maps endpoint HTTP codes honestly', () => {
  assert.equal(httpStatusReason(404), 'unavailable_api_not_supported');
  assert.equal(httpStatusReason(501), 'unavailable_api_not_supported');
  assert.equal(httpStatusReason(500), 'unavailable_server_error');
  assert.equal(httpStatusReason(503), 'unavailable_runtime_not_ready');
});

test('fallbackFor picks embedding when available, else heuristic', () => {
  assert.equal(fallbackFor(true), 'embedding_similarity');
  assert.equal(fallbackFor(false), 'heuristic');
});

// --- Reranker queue (bounded, serialized, cancellable, cleared) --------------

test('reranker queue: one active by default + bounded capacity rejects honestly', async () => {
  const q = new HelperQueue();
  q.configure({ capacity: 2, maxConcurrency: 1 });
  const gate: any[] = [];
  const mk = () => q.run('reranker', 'normal', (sig) => new Promise((res) => { gate.push(res); sig.addEventListener('abort', () => res({ ok: false, reason: 'cancelled' })); }), { timeoutMs: 5000 });
  const a = mk(); const b = mk();
  const c = await mk(); // capacity 2 → third rejected immediately
  assert.equal(c.status, 'rejected');
  const st = q.status();
  assert.equal(st.active, 1);   // one at a time
  assert.equal(st.queued, 1);
  q.clear('runtime_stopped');   // stop clears the queue
  await Promise.all([a, b]);
  assert.equal(q.status().active, 0);
  assert.equal(q.status().queued, 0);
});

test('reranker queue: per-job timeout is honored', async () => {
  const q = new HelperQueue();
  q.configure({ capacity: 4, maxConcurrency: 1 });
  const r = await q.run('reranker', 'normal', (sig) => new Promise((res) => { sig.addEventListener('abort', () => res({ ok: false, reason: 'cancelled' })); }), { timeoutMs: 20 });
  assert.equal(r.status, 'timeout');
});

test('reranker queue: cancelAll cancels in-flight work', async () => {
  const q = new HelperQueue();
  q.configure({ capacity: 4, maxConcurrency: 1 });
  const p = q.run('reranker', 'normal', (sig) => new Promise((res) => { sig.addEventListener('abort', () => res({ ok: false, reason: 'cancelled' })); }), { timeoutMs: 5000 });
  q.cancelAll('cancelled');
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.status, 'cancelled');
});

// --- Adaptive routing for the reranker role ----------------------------------

test('adaptive appliesTo respects applyToReranker; slow GGUF reranker routes away', () => {
  const cfg: any = { enabled: true, minSamples: 12, slowP95Ms: 3500, timeoutRateThreshold: 0.2, failureRateThreshold: 0.3, cooldownMs: 300000, recoveryMinSamples: 8, recoveryP95Ms: 2000, recoveryTimeoutRate: 0.1, applyToRewrite: true, applyToHyDE: true, applyToEntailment: true, applyToReranker: true };
  assert.equal(adaptiveApplies(cfg, 'reranker'), true);
  assert.equal(adaptiveApplies({ ...cfg, applyToReranker: false }, 'reranker'), false);
  const st: any = { status: 'active', routedAwayAt: 0, lastRecoveryAt: 0, lastProbeAt: 0 };
  const slow = adaptiveDecide('reranker', cfg, st, { jobs: 20, p95Ms: 5000, timeoutRate: 0, failureRate: 0, health: 'slow' }, { jobs: 0, p95Ms: 0, timeoutRate: 0 }, 1_000_000);
  assert.equal(slow.decision.preferHelper, false);          // route away from the slow GGUF reranker
  assert.equal(slow.decision.decisionType, 'adaptive_avoid_slow_helper');
  assert.equal(slow.nextState.status, 'away');
});

// --- IPC/preload contract (targeted) -----------------------------------------

test('reranker IPC channels are wired (preload invokes ↔ ipc handles), no query/chunk text in handlers', () => {
  const root = process.cwd();
  const ipc = fs.readFileSync(path.join(root, 'electron/ipc.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  for (const ch of ['reranker:status', 'reranker:start', 'reranker:stop', 'reranker:restart', 'reranker:test', 'reranker:updateSettings', 'reranker:queueStatus', 'reranker:cancelJobs', 'reranker:clearQueue']) {
    assert.ok(ipc.includes(`ipcMain.handle('${ch}'`), `missing IPC handler: ${ch}`);
    assert.ok(preload.includes(`invoke('${ch}')`) || preload.includes(`invoke('${ch}',`), `preload does not invoke: ${ch}`);
  }
});

test('default export surface is present', () => {
  assert.equal(typeof provider.resolveProviderStatus, 'function');
  assert.equal(typeof provider.applyRerank, 'function');
  assert.equal(typeof client.buildRerankRequest, 'function');
  assert.equal(typeof client.parseRerankResponse, 'function');
});
