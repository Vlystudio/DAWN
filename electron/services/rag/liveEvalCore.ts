/**
 * liveEvalCore.ts — pure, electron-free core for DAWN's LIVE-INDEX retrieval strategy eval + reranker
 * benchmark. It computes real ranking metrics (hit-rate / MRR / top-K / binary nDCG / expected-rank) from
 * *ids only*, aggregates per-strategy results, summarizes a reranker benchmark (baseline vs embedding vs
 * GGUF with honest rank-movement + lift), and honestly labels "best available" only when enough strategies
 * ran over enough labeled queries. It also builds SAFE eval queries from chunk METADATA (never chunk text)
 * and sanitizes golden-set items to safe fields only.
 *
 * By construction this module only ever sees ids, provider names, numbers, and short metadata strings — no
 * chunk text, no source text, no full paths, no prompt/response text. It reads no clock and no globals, so
 * it is exhaustively unit-testable.
 */

// --- strategy catalog --------------------------------------------------------

export type BaseMode = 'keyword' | 'vector' | 'hybrid';
export type RerankKind = 'none' | 'embedding' | 'gguf' | 'auto'; // auto = GGUF if ready else embedding
export type StrategyStatus = 'ran' | 'unavailable' | 'failed' | 'cancelled' | 'timed_out';

export interface StrategySpec {
  id: string;
  label: string;
  base: BaseMode;
  rewrite: boolean;
  hyde: boolean;
  rerank: RerankKind;
}

/** The 12 strategies DAWN can evaluate against a live index. Distinct configs — no fabricated duplicates. */
export const STRATEGY_SPECS: StrategySpec[] = [
  { id: 'keyword', label: 'Keyword (BM25)', base: 'keyword', rewrite: false, hyde: false, rerank: 'none' },
  { id: 'vector', label: 'Vector (embeddings)', base: 'vector', rewrite: false, hyde: false, rerank: 'none' },
  { id: 'hybrid', label: 'Hybrid (vector + BM25)', base: 'hybrid', rewrite: false, hyde: false, rerank: 'none' },
  { id: 'rewrite_hybrid', label: 'Query rewrite + hybrid', base: 'hybrid', rewrite: true, hyde: false, rerank: 'none' },
  { id: 'hyde_vector', label: 'HyDE + vector', base: 'vector', rewrite: false, hyde: true, rerank: 'none' },
  { id: 'hyde_hybrid', label: 'HyDE + hybrid', base: 'hybrid', rewrite: false, hyde: true, rerank: 'none' },
  { id: 'embedding_rerank', label: 'Embedding-similarity rerank (keyword base)', base: 'keyword', rewrite: false, hyde: false, rerank: 'embedding' },
  { id: 'gguf_rerank', label: 'GGUF rerank (keyword base)', base: 'keyword', rewrite: false, hyde: false, rerank: 'gguf' },
  { id: 'hybrid_embedding_rerank', label: 'Hybrid + embedding rerank', base: 'hybrid', rewrite: false, hyde: false, rerank: 'embedding' },
  { id: 'hybrid_gguf_rerank', label: 'Hybrid + GGUF rerank', base: 'hybrid', rewrite: false, hyde: false, rerank: 'gguf' },
  { id: 'rewrite_hybrid_rerank', label: 'Rewrite + hybrid + rerank', base: 'hybrid', rewrite: true, hyde: false, rerank: 'auto' },
  { id: 'hyde_hybrid_rerank', label: 'HyDE + hybrid + rerank', base: 'hybrid', rewrite: false, hyde: true, rerank: 'auto' },
];

// --- ranking metrics (ids + expected ids only) -------------------------------

/** 0-based rank of the first expected id present in `rankedIds`; null if none present (or no expected). */
export function rankOfExpected(rankedIds: string[], expected: string[]): number | null {
  if (!expected || !expected.length) return null;
  const set = new Set(expected);
  for (let i = 0; i < rankedIds.length; i++) if (set.has(rankedIds[i])) return i;
  return null;
}

export function hitAtK(rankedIds: string[], expected: string[], k: number): boolean | null {
  if (!expected || !expected.length) return null;
  const r = rankOfExpected(rankedIds.slice(0, Math.max(0, k)), expected);
  return r !== null;
}

/** Reciprocal rank: 1/(rank+1) for the first expected id, else 0. Null when there are no expected ids. */
export function reciprocalRank(rankedIds: string[], expected: string[]): number | null {
  if (!expected || !expected.length) return null;
  const r = rankOfExpected(rankedIds, expected);
  return r === null ? 0 : Number((1 / (r + 1)).toFixed(4));
}

/** Binary DCG@k (relevance 1 for expected ids, else 0). */
export function dcgBinary(rankedIds: string[], expected: string[], k: number): number {
  const set = new Set(expected || []);
  let dcg = 0;
  const top = rankedIds.slice(0, Math.max(0, k));
  for (let i = 0; i < top.length; i++) if (set.has(top[i])) dcg += 1 / Math.log2(i + 2);
  return dcg;
}

/** Binary nDCG@k. Null when there are no expected ids (honest: not fabricated). */
export function ndcgBinary(rankedIds: string[], expected: string[], k: number): number | null {
  if (!expected || !expected.length) return null;
  const rel = Math.min(expected.length, Math.max(1, k));
  let idcg = 0;
  for (let i = 0; i < rel; i++) idcg += 1 / Math.log2(i + 2);
  if (idcg === 0) return null;
  return Number((dcgBinary(rankedIds, expected, k) / idcg).toFixed(4));
}

function mean(xs: number[]): number | null { return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4)) : null; }
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(4));
}
function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
}

// --- per-strategy rows + aggregation -----------------------------------------

export interface StrategyQueryRow {
  strategy: string;
  status: StrategyStatus;
  unavailableReason?: string;
  provider?: string;               // e.g. keyword / vector / hybrid / helper_runtime / gguf_reranker
  helperFallbackUsed?: string | null;   // e.g. 'chat' when helper runtime wasn't used
  rerankerFallbackUsed?: string | null; // e.g. 'embedding_similarity' when GGUF wasn't used
  topKInput: number;
  topKOutput: number;
  latencyMs: number;
  resultIds: string[];             // SAFE ids only (already truncated to topKOutput)
  expected: string[];              // SAFE expected ids only
}

export interface StrategyAgg {
  strategy: string; label: string; status: StrategyStatus; unavailableReason?: string;
  cases: number; ranQueries: number; labeledQueries: number;
  hitRate: number | null; mrr: number | null;
  top1: number | null; top3: number | null; top5: number | null; top10: number | null;
  ndcg: number | null; ndcgReason?: string;
  avgLatencyMs: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null;
  helperFallbackCount: number; rerankerFallbackCount: number;
  failed: number; cancelled: number; timedOut: number;
  provider?: string;
}

function hitRateAt(rows: StrategyQueryRow[], k: number): number | null {
  const labeled = rows.filter((r) => r.expected && r.expected.length);
  if (!labeled.length) return null;
  const hits = labeled.filter((r) => hitAtK(r.resultIds, r.expected, k) === true).length;
  return Number((hits / labeled.length).toFixed(4));
}

/** Aggregate one strategy across all queries. Metrics only over queries that RAN and are LABELED. */
export function aggregateStrategy(spec: StrategySpec, rows: StrategyQueryRow[], topK: number): StrategyAgg {
  const ran = rows.filter((r) => r.status === 'ran');
  const labeled = ran.filter((r) => r.expected && r.expected.length);
  const rrs = labeled.map((r) => reciprocalRank(r.resultIds, r.expected)).filter((x): x is number => x !== null);
  const ndcgs = labeled.map((r) => ndcgBinary(r.resultIds, r.expected, topK)).filter((x): x is number => x !== null);
  const lats = ran.map((r) => r.latencyMs).filter((x) => typeof x === 'number');
  // overall status = 'ran' if any ran, else the dominant non-ran status
  const status: StrategyStatus = ran.length ? 'ran'
    : rows.some((r) => r.status === 'timed_out') ? 'timed_out'
    : rows.some((r) => r.status === 'failed') ? 'failed'
    : rows.some((r) => r.status === 'cancelled') ? 'cancelled' : 'unavailable';
  const unavailableReason = ran.length ? undefined : (rows.find((r) => r.unavailableReason)?.unavailableReason);
  return {
    strategy: spec.id, label: spec.label, status, unavailableReason,
    cases: rows.length, ranQueries: ran.length, labeledQueries: labeled.length,
    hitRate: hitRateAt(ran, topK), mrr: rrs.length ? mean(rrs) : null,
    top1: hitRateAt(ran, 1), top3: hitRateAt(ran, 3), top5: hitRateAt(ran, 5), top10: hitRateAt(ran, 10),
    ndcg: ndcgs.length ? mean(ndcgs) : null, ndcgReason: ndcgs.length ? undefined : 'no labeled queries ran',
    avgLatencyMs: mean(lats), p50LatencyMs: pct(lats, 50), p95LatencyMs: pct(lats, 95),
    helperFallbackCount: ran.filter((r) => r.helperFallbackUsed).length,
    rerankerFallbackCount: ran.filter((r) => r.rerankerFallbackUsed).length,
    failed: rows.filter((r) => r.status === 'failed').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    timedOut: rows.filter((r) => r.status === 'timed_out').length,
    provider: ran[0]?.provider,
  };
}

export type BestQualifier = 'best_available' | 'only_available' | 'insufficient_samples' | 'unlabeled' | 'none';
export interface LiveEvalSummary {
  strategies: StrategyAgg[];
  ranStrategies: number; unavailableStrategies: number; failedStrategies: number; cancelledOrTimedOut: number;
  totalQueries: number; labeledQueries: number; helperFallbackCount: number; rerankerFallbackCount: number;
  best: string | null; bestLabel: string | null; bestQualifier: BestQualifier;
}

/**
 * Roll up per-strategy aggregates. HONEST "best": only when ≥ minStrategies strategies actually ran over
 * ≥ minQueries labeled queries. One strategy → 'only_available'; too few labeled queries → 'insufficient
 * samples'; no labeled queries → 'unlabeled' (coverage only, no hit-rate/MRR ranking).
 */
export function summarizeLive(aggs: StrategyAgg[], totalQueries: number, opts: { minStrategies?: number; minQueries?: number } = {}): LiveEvalSummary {
  const minStrategies = opts.minStrategies ?? 2;
  const minQueries = opts.minQueries ?? 3;
  const ran = aggs.filter((a) => a.status === 'ran');
  const labeledQueries = Math.max(0, ...aggs.map((a) => a.labeledQueries), 0);
  const ranking = ran.filter((a) => a.hitRate !== null && a.labeledQueries >= minQueries);

  let best: string | null = null, bestLabel: string | null = null, bestQualifier: BestQualifier = 'none';
  if (!aggs.some((a) => a.labeledQueries > 0)) {
    bestQualifier = 'unlabeled';
  } else if (ranking.length === 0) {
    bestQualifier = 'insufficient_samples';
  } else if (ranking.length === 1) {
    best = ranking[0].strategy; bestLabel = ranking[0].label; bestQualifier = 'only_available';
  } else {
    const sorted = ranking.slice().sort((a, b) => (b.hitRate! - a.hitRate!) || ((b.mrr ?? 0) - (a.mrr ?? 0)));
    best = sorted[0].strategy; bestLabel = sorted[0].label;
    bestQualifier = ran.length >= minStrategies ? 'best_available' : 'only_available';
  }

  return {
    strategies: aggs,
    ranStrategies: ran.length,
    unavailableStrategies: aggs.filter((a) => a.status === 'unavailable').length,
    failedStrategies: aggs.filter((a) => a.status === 'failed').length,
    cancelledOrTimedOut: aggs.filter((a) => a.status === 'cancelled' || a.status === 'timed_out').length,
    totalQueries, labeledQueries,
    helperFallbackCount: aggs.reduce((s, a) => s + a.helperFallbackCount, 0),
    rerankerFallbackCount: aggs.reduce((s, a) => s + a.rerankerFallbackCount, 0),
    best, bestLabel, bestQualifier,
  };
}

// --- reranker benchmark ------------------------------------------------------

export type Movement = 'improved' | 'worsened' | 'unchanged' | 'n/a';
export function movement(fromRank: number | null, toRank: number | null): Movement {
  if (fromRank === null || toRank === null) return 'n/a';
  if (toRank < fromRank) return 'improved';
  if (toRank > fromRank) return 'worsened';
  return 'unchanged';
}

export interface BenchInput {
  expected: string[];
  baselineIds: string[];
  embeddingIds: string[];
  ggufIds: string[] | null;                 // null when GGUF didn't run
  ggufStatus: 'ran' | 'unavailable' | 'failed' | 'timed_out';
  ggufUnavailableReason?: string;
  ggufFallbackUsed?: string | null;
  embeddingLatencyMs: number;
  ggufLatencyMs: number | null;
}

export interface OrderMetrics { mrr: number | null; top1: number | null; top3: number | null; top5: number | null; top10: number | null; ndcg: number | null }
export type LiftLabel = 'improves' | 'worsens' | 'no_change' | 'unavailable' | 'insufficient_samples';

export interface BenchmarkSummary {
  queries: number; labeledQueries: number;
  baseline: OrderMetrics; embedding: OrderMetrics; gguf: OrderMetrics | null;
  ndcgReason?: string;
  rankMovement: {
    embedding: { improved: number; worsened: number; unchanged: number; avg: number | null; median: number | null };
    gguf: { improved: number; worsened: number; unchanged: number; avg: number | null; median: number | null } | null;
  };
  latency: { embeddingAvgMs: number | null; embeddingP95Ms: number | null; ggufAvgMs: number | null; ggufP95Ms: number | null };
  ggufRanCount: number; ggufUnavailableCount: number; ggufTimeoutCount: number; ggufFailedCount: number; ggufFallbackCount: number;
  embeddingLift: LiftLabel; ggufLift: LiftLabel; ggufLiftReason?: string;
}

function orderMetrics(rows: { ids: string[]; expected: string[] }[], k: number): OrderMetrics {
  const labeled = rows.filter((r) => r.expected.length);
  if (!labeled.length) return { mrr: null, top1: null, top3: null, top5: null, top10: null, ndcg: null };
  const rr = labeled.map((r) => reciprocalRank(r.ids, r.expected)!).filter((x) => x !== null);
  const nd = labeled.map((r) => ndcgBinary(r.ids, r.expected, k)!).filter((x) => x !== null);
  const at = (kk: number) => Number((labeled.filter((r) => hitAtK(r.ids, r.expected, kk) === true).length / labeled.length).toFixed(4));
  return { mrr: mean(rr), top1: at(1), top3: at(3), top5: at(5), top10: at(10), ndcg: nd.length ? mean(nd) : null };
}

function liftLabel(base: number | null, cand: number | null): LiftLabel {
  if (base === null || cand === null) return 'insufficient_samples';
  if (cand > base) return 'improves';
  if (cand < base) return 'worsens';
  return 'no_change';
}

/**
 * Summarize a reranker benchmark. GGUF metrics are computed ONLY over queries where GGUF actually ran — if
 * it never ran, the GGUF section is null and its lift is 'unavailable' (never inferred). Rank movement of
 * the expected id is measured per order; nDCG is binary or honestly unavailable. Pure.
 */
export function summarizeBenchmark(inputs: BenchInput[], k = 10, opts: { minQueries?: number } = {}): BenchmarkSummary {
  const minQueries = opts.minQueries ?? 3;
  const labeled = inputs.filter((i) => i.expected && i.expected.length);
  const baseline = orderMetrics(inputs.map((i) => ({ ids: i.baselineIds, expected: i.expected })), k);
  const embedding = orderMetrics(inputs.map((i) => ({ ids: i.embeddingIds, expected: i.expected })), k);
  const ggufRows = inputs.filter((i) => i.ggufStatus === 'ran' && i.ggufIds);
  const gguf = ggufRows.length ? orderMetrics(ggufRows.map((i) => ({ ids: i.ggufIds as string[], expected: i.expected })), k) : null;

  const embMoves = labeled.map((i) => movement(rankOfExpected(i.baselineIds, i.expected), rankOfExpected(i.embeddingIds, i.expected)));
  const embDeltas = labeled.map((i) => { const a = rankOfExpected(i.baselineIds, i.expected), b = rankOfExpected(i.embeddingIds, i.expected); return a !== null && b !== null ? a - b : null; }).filter((x): x is number => x !== null);
  const ggufLabeled = ggufRows.filter((i) => i.expected.length);
  const ggufMoves = ggufLabeled.map((i) => movement(rankOfExpected(i.baselineIds, i.expected), rankOfExpected(i.ggufIds as string[], i.expected)));
  const ggufDeltas = ggufLabeled.map((i) => { const a = rankOfExpected(i.baselineIds, i.expected), b = rankOfExpected(i.ggufIds as string[], i.expected); return a !== null && b !== null ? a - b : null; }).filter((x): x is number => x !== null);

  const count = (arr: Movement[], m: Movement) => arr.filter((x) => x === m).length;
  const embLat = inputs.map((i) => i.embeddingLatencyMs).filter((x) => typeof x === 'number');
  const ggufLat = ggufRows.map((i) => i.ggufLatencyMs).filter((x): x is number => typeof x === 'number');

  const enoughLabeled = labeled.length >= minQueries;
  const embeddingLift: LiftLabel = !enoughLabeled ? 'insufficient_samples' : liftLabel(baseline.mrr, embedding.mrr);
  let ggufLift: LiftLabel; let ggufLiftReason: string | undefined;
  if (!gguf) { ggufLift = 'unavailable'; ggufLiftReason = inputs.find((i) => i.ggufUnavailableReason)?.ggufUnavailableReason || 'GGUF reranker did not run'; }
  else if (ggufLabeled.length < minQueries) { ggufLift = 'insufficient_samples'; ggufLiftReason = `only ${ggufLabeled.length} labeled GGUF quer${ggufLabeled.length === 1 ? 'y' : 'ies'}`; }
  else ggufLift = liftLabel(baseline.mrr, gguf.mrr);

  return {
    queries: inputs.length, labeledQueries: labeled.length,
    baseline, embedding, gguf,
    ndcgReason: labeled.length ? undefined : 'no labeled queries',
    rankMovement: {
      embedding: { improved: count(embMoves, 'improved'), worsened: count(embMoves, 'worsened'), unchanged: count(embMoves, 'unchanged'), avg: mean(embDeltas), median: median(embDeltas) },
      gguf: gguf ? { improved: count(ggufMoves, 'improved'), worsened: count(ggufMoves, 'worsened'), unchanged: count(ggufMoves, 'unchanged'), avg: mean(ggufDeltas), median: median(ggufDeltas) } : null,
    },
    latency: { embeddingAvgMs: mean(embLat), embeddingP95Ms: pct(embLat, 95), ggufAvgMs: mean(ggufLat), ggufP95Ms: pct(ggufLat, 95) },
    ggufRanCount: ggufRows.length,
    ggufUnavailableCount: inputs.filter((i) => i.ggufStatus === 'unavailable').length,
    ggufTimeoutCount: inputs.filter((i) => i.ggufStatus === 'timed_out').length,
    ggufFailedCount: inputs.filter((i) => i.ggufStatus === 'failed').length,
    ggufFallbackCount: inputs.filter((i) => i.ggufFallbackUsed).length,
    embeddingLift, ggufLift, ggufLiftReason,
  };
}

// --- metadata-generated query set (metadata only — NEVER chunk text) ---------

export interface SafeChunkMeta { chunkId: string; sourceId: string; name?: string; chunkTitle?: string; parentHeading?: string; sectionPath?: string }
export interface GeneratedQuery { query: string; expectedChunkIds: string[]; expectedSourceIds: string[]; label: string }

function basenameNoExt(name?: string): string {
  const b = String(name || '').split(/[\\/]/).pop() || '';
  return b.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

/**
 * Build safe eval queries from chunk METADATA only (chunk title / section path / parent heading / file
 * basename) — NEVER from raw chunk text. Each query expects its own chunk (self-retrieval labeling).
 * Rows with no usable metadata are skipped honestly. Deduped; bounded by `max`.
 */
export function metadataQueries(rows: SafeChunkMeta[], opts: { max?: number } = {}): GeneratedQuery[] {
  const max = opts.max && opts.max > 0 ? opts.max : 50;
  const out: GeneratedQuery[] = [];
  const seen = new Set<string>();
  for (const r of rows || []) {
    const q = String(r.chunkTitle || r.sectionPath || r.parentHeading || basenameNoExt(r.name) || '').trim();
    if (!q || q.length < 3) continue;                    // no usable metadata → skip (never fabricate)
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query: q.slice(0, 200), expectedChunkIds: [r.chunkId], expectedSourceIds: r.sourceId ? [r.sourceId] : [], label: 'metadata' });
    if (out.length >= max) break;
  }
  return out;
}

// --- golden set (safe fields only) -------------------------------------------

export interface GoldenItem {
  id: string; query: string;
  expectedSourceId?: string; expectedChunkId?: string; citationId?: string;
  label?: string; notes?: string; createdAt: number;
}

const clip = (s: any, n: number) => (typeof s === 'string' ? s.slice(0, n) : undefined);

/**
 * Sanitize a golden-set item to SAFE fields only. Requires a non-empty query; keeps only whitelisted id +
 * label + notes fields (bounded length). Anything else (e.g. chunk text) is dropped. Returns null if invalid.
 */
export function sanitizeGoldenItem(input: any, now: number, idFn: () => string): GoldenItem | null {
  if (!input || typeof input !== 'object') return null;
  const query = clip(String(input.query || '').trim(), 300);
  if (!query) return null;
  return {
    id: clip(String(input.id || ''), 64) || idFn(),
    query,
    expectedSourceId: clip(input.expectedSourceId, 64),
    expectedChunkId: clip(input.expectedChunkId, 64),
    citationId: clip(input.citationId, 128),
    label: clip(input.label, 80),
    notes: clip(input.notes, 300),
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
  };
}

export default {
  STRATEGY_SPECS, rankOfExpected, hitAtK, reciprocalRank, dcgBinary, ndcgBinary,
  aggregateStrategy, summarizeLive, movement, summarizeBenchmark, metadataQueries, sanitizeGoldenItem,
};
