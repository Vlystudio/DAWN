/**
 * rerankerProviderCore.ts — pure, electron-free reranker PROVIDER model. It answers two honest questions
 * without ever faking a cross-encoder:
 *
 *   1. What is the status of the configured reranker provider? (ready / why-not / score semantics / fallback)
 *   2. Given a query's candidate set, which provider actually runs, and how are scores applied?
 *
 * DAWN's honest providers:
 *   disabled            — no rerank stage (hybrid RRF order kept).
 *   embedding_similarity— real local cosine re-order of the top candidates (score type: cosine_similarity).
 *   heuristic           — hybrid RRF order kept (used when embeddings are unavailable).
 *   gguf_reranker       — a REAL local GGUF cross-encoder/reranker served by llama-server's /rerank endpoint
 *                         (score type: reranker_relevance). ONLY when the runtime + model + endpoint truly work.
 *
 * Every "unavailable" is a specific, honest reason — never inferred from mere reachability. Scores are never
 * fabricated: when a provider is unavailable, applyRerank returns null scores (original hybrid order kept).
 * This module holds NO prompt/query/chunk text (it only ever sees ids + numeric scores), so nothing private
 * can leak through it. It reads no clock and no global state, so it is exhaustively unit-testable.
 */

export type RerankProviderId = 'disabled' | 'embedding_similarity' | 'heuristic' | 'gguf_reranker';

export type RerankUnavailableReason =
  | 'none'
  | 'unavailable_needs_setup'
  | 'unavailable_model_missing'
  | 'unavailable_runtime_missing'
  | 'unavailable_runtime_not_ready'
  | 'unavailable_runtime_unsupported'
  | 'unavailable_api_not_supported'
  | 'unavailable_server_error'
  | 'unavailable_timeout';

export type RerankScoreType = 'cosine_similarity' | 'reranker_relevance' | 'heuristic' | 'none';
export type RerankScoreSemantics = 'relative' | 'calibrated' | 'unknown';
export type RerankStatusLabel = 'READY' | 'DISABLED' | 'NEEDS_SETUP' | 'UNAVAILABLE';

/** Full, redacted provider status for UI / IPC / trace (no path, no chunk text). */
export interface RerankProviderStatus {
  id: RerankProviderId;
  displayName: string;
  ready: boolean;
  statusLabel: RerankStatusLabel;
  unavailableReason: RerankUnavailableReason;
  scoreType: RerankScoreType;
  scoreSemantics: RerankScoreSemantics;
  modelSummary: string;            // basename only — never a full path
  endpoint: string | null;         // local 127.0.0.1 endpoint when applicable
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastError: string | null;        // redacted (no path/prompt/chunk)
  fallbackProvider: RerankProviderId;
}

export interface ProviderResolveInputs {
  provider: string;                // settings.reranker.provider (selected)
  embeddingsAvailable: boolean;
  ggufEnabled: boolean;
  ggufModelConfigured: boolean;    // a model path is set
  ggufModelExists: boolean;        // that path exists on disk
  runtimeInstalled: boolean;       // llama-server.exe present
  runtimeRunning: boolean;         // the reranker process is alive
  runtimeReachable: boolean;       // last /health was ok
  endpointSupported: boolean | null; // null = not yet probed
  capabilityReason: RerankUnavailableReason; // from the last endpoint probe
  lastTestOk?: boolean | null;
  lastTestLatencyMs?: number | null;
  lastError?: string | null;       // already redacted upstream
  modelSummary?: string;           // basename only
  endpoint?: string | null;
}

const DISPLAY: Record<RerankProviderId, string> = {
  disabled: 'Disabled',
  embedding_similarity: 'Embedding similarity',
  heuristic: 'Heuristic (hybrid RRF)',
  gguf_reranker: 'GGUF reranker (local cross-encoder)',
};

function normProvider(p: string): RerankProviderId {
  if (p === 'gguf' || p === 'gguf_reranker' || p === 'cross_encoder') return 'gguf_reranker';
  if (p === 'embedding' || p === 'embedding_similarity') return 'embedding_similarity';
  if (p === 'heuristic') return 'heuristic';
  return p === 'disabled' ? 'disabled' : 'embedding_similarity';
}

/** Which honest fallback a query would use when the selected provider can't run. */
export function fallbackFor(embeddingsAvailable: boolean): RerankProviderId {
  return embeddingsAvailable ? 'embedding_similarity' : 'heuristic';
}

function labelForReason(r: RerankUnavailableReason): RerankStatusLabel {
  switch (r) {
    case 'none': return 'READY';
    case 'unavailable_needs_setup':
    case 'unavailable_model_missing':
    case 'unavailable_runtime_missing':
    case 'unavailable_runtime_unsupported':
    case 'unavailable_api_not_supported':
      return 'NEEDS_SETUP';
    default:
      return 'UNAVAILABLE'; // runtime_not_ready / server_error / timeout
  }
}

/**
 * Honest GGUF-reranker capability chain: exe → model configured → model exists → running → reachable →
 * endpoint probed & supported. Never claims READY just because the server is reachable.
 */
export function ggufReason(i: ProviderResolveInputs): RerankUnavailableReason {
  if (!i.runtimeInstalled) return 'unavailable_runtime_missing';
  if (!i.ggufModelConfigured) return 'unavailable_needs_setup';
  if (!i.ggufModelExists) return 'unavailable_model_missing';
  if (!i.runtimeRunning || !i.runtimeReachable) return 'unavailable_runtime_not_ready';
  if (i.endpointSupported === null) return 'unavailable_runtime_not_ready'; // reachable but capability not yet verified
  if (i.endpointSupported === false) return i.capabilityReason && i.capabilityReason !== 'none' ? i.capabilityReason : 'unavailable_api_not_supported';
  return 'none';
}

/** Resolve the full status of the SELECTED reranker provider (redacted, honest). */
export function resolveProviderStatus(i: ProviderResolveInputs): RerankProviderStatus {
  const selected = normProvider(i.provider);
  const fallback = fallbackFor(i.embeddingsAvailable);
  const base = {
    modelSummary: i.modelSummary || '',
    endpoint: i.endpoint || null,
    lastTestOk: i.lastTestOk ?? null,
    lastTestLatencyMs: i.lastTestLatencyMs ?? null,
    lastError: i.lastError || null,
  };

  if (selected === 'disabled') {
    return { id: 'disabled', displayName: DISPLAY.disabled, ready: false, statusLabel: 'DISABLED', unavailableReason: 'none', scoreType: 'none', scoreSemantics: 'unknown', fallbackProvider: 'disabled', ...base, modelSummary: '' };
  }

  if (selected === 'heuristic') {
    return { id: 'heuristic', displayName: DISPLAY.heuristic, ready: true, statusLabel: 'READY', unavailableReason: 'none', scoreType: 'heuristic', scoreSemantics: 'unknown', fallbackProvider: 'disabled', ...base, modelSummary: '' };
  }

  if (selected === 'embedding_similarity') {
    const ready = i.embeddingsAvailable;
    return {
      id: 'embedding_similarity', displayName: DISPLAY.embedding_similarity, ready,
      statusLabel: ready ? 'READY' : 'NEEDS_SETUP', unavailableReason: ready ? 'none' : 'unavailable_needs_setup',
      scoreType: 'cosine_similarity', scoreSemantics: 'relative', fallbackProvider: 'heuristic', ...base, modelSummary: '',
    };
  }

  // gguf_reranker (selected)
  const reason = i.ggufEnabled ? ggufReason(i) : 'unavailable_needs_setup';
  const ready = reason === 'none';
  return {
    id: 'gguf_reranker', displayName: DISPLAY.gguf_reranker, ready,
    statusLabel: ready ? 'READY' : labelForReason(reason), unavailableReason: reason,
    // A GGUF reranker's relevance score is a real cross-encoder signal but NOT a calibrated probability → 'relative'.
    scoreType: ready ? 'reranker_relevance' : 'none', scoreSemantics: ready ? 'relative' : 'unknown',
    fallbackProvider: fallback, ...base,
  };
}

// ---------------------------------------------------------------------------
// Rerank plan: which provider actually runs for THIS query, honoring the master
// rerank toggle (back-compat) and honest GGUF fallback.
// ---------------------------------------------------------------------------

export interface RerankPlan {
  selected: RerankProviderId;      // what the user configured
  provider: RerankProviderId;      // what actually runs for this query
  scoreType: RerankScoreType;
  reason: string;
  usedFallback: boolean;
  unavailableReason: RerankUnavailableReason;
}

export interface PlanInputs {
  selected: string;
  rerankerEnabled: boolean;        // legacy master toggle governs embedding/heuristic rerank stage
  embeddingsAvailable: boolean;
  ggufEnabled: boolean;
  ggufReady: boolean;
  ggufUnavailableReason: RerankUnavailableReason;
}

function planFor(provider: RerankProviderId, scoreType: RerankScoreType, reason: string, selected: RerankProviderId, usedFallback = false, unavailableReason: RerankUnavailableReason = 'none'): RerankPlan {
  return { selected, provider, scoreType, reason, usedFallback, unavailableReason };
}

/**
 * Decide the provider that runs for one query. Choosing GGUF opts into reranking (falls back honestly when
 * the runtime is down); embedding/heuristic still honor the existing `rerankerEnabled` master toggle so the
 * default (off) behavior is byte-for-byte preserved. Pure.
 */
export function resolveRerankPlan(inp: PlanInputs): RerankPlan {
  const sel = normProvider(inp.selected);

  if (sel === 'gguf_reranker') {
    if (inp.ggufEnabled && inp.ggufReady) return planFor('gguf_reranker', 'reranker_relevance', 'Local GGUF reranker.', sel);
    // GGUF unavailable → honest fallback (embedding if available, else heuristic/hybrid order).
    const fb = fallbackFor(inp.embeddingsAvailable);
    if (fb === 'embedding_similarity') return planFor('embedding_similarity', 'cosine_similarity', 'GGUF reranker unavailable — using embedding-similarity rerank.', sel, true, inp.ggufUnavailableReason);
    return planFor('heuristic', 'heuristic', 'GGUF reranker unavailable and no embeddings — hybrid (RRF) order kept.', sel, true, inp.ggufUnavailableReason);
  }

  if (sel === 'disabled') return planFor('disabled', 'none', 'Reranker disabled — hybrid (RRF) order kept.', sel);

  // embedding_similarity / heuristic honor the master toggle (default off → no rerank stage).
  if (!inp.rerankerEnabled) return planFor('disabled', 'none', 'Reranker disabled — hybrid (RRF) order kept.', sel);
  if (sel === 'embedding_similarity') {
    return inp.embeddingsAvailable
      ? planFor('embedding_similarity', 'cosine_similarity', 'Embedding-similarity rerank of the top candidates.', sel)
      : planFor('heuristic', 'heuristic', 'No embeddings available — hybrid (RRF + title boost) order kept.', sel, true, 'unavailable_needs_setup');
  }
  return planFor('heuristic', 'heuristic', 'Heuristic hybrid (RRF) order kept.', sel);
}

// ---------------------------------------------------------------------------
// Score application (ids + numeric scores only — never any candidate text).
// ---------------------------------------------------------------------------

export interface RerankScored { id: string; score: number | null }
export interface RerankApplied { id: string; originalRank: number; rerankedRank: number; score: number | null }

/**
 * Apply reranker scores to an ordered candidate id list. `scores` may be null (provider unavailable →
 * original order kept, all null), may omit some ids (those keep null score → sorted after scored items in
 * original order), and is never fabricated. Returns each id with its original + reranked rank. Pure/stable.
 */
export function applyRerank(candidateIds: string[], scores: RerankScored[] | null): RerankApplied[] {
  const scoreMap = new Map<string, number>();
  if (scores) for (const s of scores) if (s && typeof s.score === 'number' && isFinite(s.score)) scoreMap.set(s.id, s.score);
  const rows = candidateIds.map((id, i) => ({ id, originalRank: i, score: scoreMap.has(id) ? scoreMap.get(id)! : null }));
  const ordered = rows.slice().sort((a, b) => {
    const aHas = a.score !== null, bHas = b.score !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;         // scored first
    if (aHas && bHas && a.score !== b.score) return (b.score as number) - (a.score as number); // higher score first
    return a.originalRank - b.originalRank;           // stable
  });
  return ordered.map((r, i) => ({ id: r.id, originalRank: r.originalRank, rerankedRank: i, score: r.score }));
}

export interface ScoresSummary { count: number; min: number | null; max: number | null; mean: number | null }
/** Safe numeric summary of reranker scores (no candidate text). */
export function scoresSummary(scores: RerankScored[] | null): ScoresSummary {
  const vals = (scores || []).map((s) => s.score).filter((v): v is number => typeof v === 'number' && isFinite(v));
  if (!vals.length) return { count: 0, min: null, max: null, mean: null };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { count: vals.length, min: r3(Math.min(...vals)), max: r3(Math.max(...vals)), mean: r3(vals.reduce((a, b) => a + b, 0) / vals.length) };
}

/** Human label for the unavailable reason (UI). */
export function reasonLabel(r: RerankUnavailableReason): string {
  switch (r) {
    case 'none': return '';
    case 'unavailable_needs_setup': return 'needs setup (choose a reranker model)';
    case 'unavailable_model_missing': return 'model file missing';
    case 'unavailable_runtime_missing': return 'llama-server runtime missing';
    case 'unavailable_runtime_not_ready': return 'runtime not running / not reachable';
    case 'unavailable_runtime_unsupported': return 'runtime build does not support reranking';
    case 'unavailable_api_not_supported': return 'server reachable but /rerank endpoint not supported';
    case 'unavailable_server_error': return 'reranker returned a malformed / error response';
    case 'unavailable_timeout': return 'reranker timed out';
    default: return String(r);
  }
}

export function displayName(id: RerankProviderId): string { return DISPLAY[id] || String(id); }

export default {
  resolveProviderStatus, resolveRerankPlan, ggufReason, fallbackFor,
  applyRerank, scoresSummary, reasonLabel, displayName, normProvider,
};
