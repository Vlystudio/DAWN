/**
 * livePreflightCore.ts — pure, electron-free preflight for LIVE-INDEX eval. Given SAFE index signals +
 * provider readiness (counts, booleans, redacted names — never any chunk/source text or full paths), it
 * decides whether a live eval can run and which of the 12 strategies are eligible, with an honest reason
 * for every unavailable one. It never infers a capability it can't see (no embeddings → vector/hybrid
 * unavailable; no helper/chat → rewrite/HyDE unavailable; GGUF not ready → GGUF rerank unavailable).
 * Reads no clock/globals — exhaustively unit-testable.
 */
import { STRATEGY_SPECS, StrategySpec } from './liveEvalCore';

export interface PreflightSignals {
  sourceCount: number;
  availableSourceCount: number;              // indexed/stale (searchable)
  excludedSourceCount: number;               // skipped + removed + blocked
  chunkCount: number;
  embeddedChunkCount: number;
  chunkStrategyDistribution: Record<string, number>;
  outdatedSourceCount: number;
  embedModelSummary: string;                 // redacted (name only)
  rerankerReady: boolean;
  rerankerProvider: string;
  rerankerUnavailableReason: string;
  helperRuntimeReady: boolean;
  chatReady: boolean;
  preferChatFallback: boolean;
  adaptiveEnabled: boolean;
}

export interface StrategyEligibility {
  strategy: string; label: string; eligible: boolean; reason?: string;
  expectedProvider?: string; helperFallback?: string | null; rerankerFallback?: string | null;
}

export interface Preflight {
  canRunLive: boolean;
  canRunReason: string;
  index: {
    sources: number; availableSources: number; excludedSources: number;
    chunks: number; embeddedChunks: number; outdatedSources: number;
    strategyDistribution: Record<string, number>; embedModel: string; embeddingsAvailable: boolean;
  };
  providers: {
    reranker: { ready: boolean; provider: string; unavailableReason: string };
    helper: { helperRuntimeReady: boolean; chatReady: boolean; rewriteProvider: string | null };
    adaptive: { enabled: boolean };
  };
  strategies: StrategyEligibility[];
  eligibleCount: number;
}

/** Which provider would serve a rewrite/HyDE helper call: dedicated runtime → chat fallback → none. */
function helperProvider(sig: PreflightSignals): { provider: string | null; fallback: string | null } {
  if (sig.helperRuntimeReady) return { provider: 'helper_runtime', fallback: null };
  if (sig.chatReady && sig.preferChatFallback) return { provider: 'chat', fallback: 'chat' };
  return { provider: null, fallback: null };
}

function eligibilityFor(spec: StrategySpec, sig: PreflightSignals): StrategyEligibility {
  const emb = sig.embeddedChunkCount > 0;
  const hp = helperProvider(sig);
  const base: StrategyEligibility = { strategy: spec.id, label: spec.label, eligible: true };

  // Base retrieval requirement.
  if ((spec.base === 'vector' || spec.base === 'hybrid') && !emb) {
    return { ...base, eligible: false, reason: `no embeddings in the live index (${spec.base} needs vectors)`, expectedProvider: spec.base };
  }
  // Rewrite / HyDE helper requirement.
  if ((spec.rewrite || spec.hyde) && !hp.provider) {
    return { ...base, eligible: false, reason: 'helper runtime not ready and chat fallback unavailable', expectedProvider: null };
  }
  // Reranker requirement.
  let rerankerFallback: string | null = null;
  if (spec.rerank === 'gguf') {
    if (!sig.rerankerReady) return { ...base, eligible: false, reason: `GGUF reranker unavailable (${sig.rerankerUnavailableReason || 'not ready'})`, expectedProvider: 'gguf_reranker' };
  } else if (spec.rerank === 'embedding') {
    if (!emb) return { ...base, eligible: false, reason: 'embedding rerank needs embeddings', expectedProvider: 'embedding_similarity' };
  } else if (spec.rerank === 'auto') {
    if (!emb && !sig.rerankerReady) return { ...base, eligible: false, reason: 'no reranker available (no embeddings, GGUF not ready)', expectedProvider: null };
    if (!sig.rerankerReady) rerankerFallback = 'embedding_similarity'; // GGUF preferred but unavailable → embedding
  }

  const provider = spec.rerank === 'gguf' ? 'gguf_reranker'
    : spec.rerank === 'embedding' ? 'embedding_similarity'
    : spec.rerank === 'auto' ? (sig.rerankerReady ? 'gguf_reranker' : 'embedding_similarity')
    : spec.base;
  return { ...base, expectedProvider: provider, helperFallback: (spec.rewrite || spec.hyde) ? hp.fallback : null, rerankerFallback };
}

export function preflight(sig: PreflightSignals): Preflight {
  const emb = sig.embeddedChunkCount > 0;
  const canRunLive = sig.chunkCount > 0;
  const canRunReason = canRunLive
    ? (sig.availableSourceCount > 0 ? 'live index ready' : 'index has chunks but no searchable sources')
    : 'no live index — add + index a folder in Local Knowledge first';
  const hp = helperProvider(sig);
  const strategies = STRATEGY_SPECS.map((spec) => eligibilityFor(spec, sig));
  return {
    canRunLive,
    canRunReason,
    index: {
      sources: sig.sourceCount, availableSources: sig.availableSourceCount, excludedSources: sig.excludedSourceCount,
      chunks: sig.chunkCount, embeddedChunks: sig.embeddedChunkCount, outdatedSources: sig.outdatedSourceCount,
      strategyDistribution: sig.chunkStrategyDistribution || {}, embedModel: sig.embedModelSummary || '', embeddingsAvailable: emb,
    },
    providers: {
      reranker: { ready: sig.rerankerReady, provider: sig.rerankerProvider, unavailableReason: sig.rerankerUnavailableReason },
      helper: { helperRuntimeReady: sig.helperRuntimeReady, chatReady: sig.chatReady, rewriteProvider: hp.provider },
      adaptive: { enabled: sig.adaptiveEnabled },
    },
    strategies,
    eligibleCount: strategies.filter((s) => s.eligible).length,
  };
}

export default { preflight };
