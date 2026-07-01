/**
 * reranker.ts — electron wrapper that picks the honest reranker provider from settings + real capability.
 *
 * DAWN's reranking is honest by construction:
 *   - embedding_similarity is the READY default: a real local cosine re-order of the top candidates.
 *   - heuristic is the no-embeddings fallback (hybrid RRF order kept).
 *   - gguf_reranker is a REAL local GGUF cross-encoder served by a dedicated llama-server (--reranking); it is
 *     used ONLY when that runtime + model + /rerank endpoint are proven to work (rerankerRuntime.isReady()).
 *     When it's unavailable, we fall back honestly to embedding-similarity (or hybrid order) and say why.
 *
 * No cross-encoder is ever claimed unless the GGUF endpoint actually returned a well-formed relevance score.
 * Vault/auth/audit content is never in the knowledge chunks, so it is never reranked. No fake scores.
 */
import * as fs from 'fs';
import settings from '../settings';
import core, { RerankMode } from './rerankerCore';
import providerCore, { RerankProviderStatus, RerankPlan } from './rerankerProviderCore';
import rerankerRuntime from './rerankerRuntime';

function safeExists(p: string): boolean { try { return !!p && fs.existsSync(p); } catch { return false; } }

/** Legacy embedding/heuristic mode decision (kept for the embedding rerank math path). */
export function decide(embeddingsAvailable: boolean): { mode: RerankMode; reason: string } {
  const s: any = settings.get();
  return core.resolveRerankMode({
    enabled: !!s.rerankerEnabled,
    embeddingsAvailable,
    crossEncoderAvailable: false, // handled by the GGUF path/plan, not this legacy resolver
    rerankerModelConfigured: safeExists(s.rerankerModelPath),
  });
}

/** Full, redacted status of the SELECTED reranker provider (for UI / IPC / System Health). */
export function providerStatus(embeddingsAvailable = true): RerankProviderStatus {
  const s: any = settings.get();
  const rr = rerankerRuntime.status();
  return providerCore.resolveProviderStatus({
    provider: (s.reranker && s.reranker.provider) || 'embedding_similarity',
    embeddingsAvailable,
    ggufEnabled: !!(s.reranker && s.reranker.gguf && s.reranker.gguf.enabled),
    ggufModelConfigured: !!(s.reranker && s.reranker.gguf && s.reranker.gguf.modelPath),
    ggufModelExists: safeExists(s.reranker && s.reranker.gguf && s.reranker.gguf.modelPath),
    runtimeInstalled: rr.installed,
    runtimeRunning: rr.running,
    runtimeReachable: rr.reachable,
    endpointSupported: rr.endpointSupported,
    capabilityReason: rr.apiReason,
    lastTestOk: rr.lastTestOk,
    lastTestLatencyMs: rr.lastTestLatencyMs,
    lastError: rr.error,
    modelSummary: rr.modelName,
    endpoint: rr.endpoint,
  });
}

/** The provider that ACTUALLY runs for a query (honors master toggle + honest GGUF fallback). */
export function plan(embeddingsAvailable: boolean): RerankPlan {
  const s: any = settings.get();
  return providerCore.resolveRerankPlan({
    selected: (s.reranker && s.reranker.provider) || 'embedding_similarity',
    rerankerEnabled: !!s.rerankerEnabled,
    embeddingsAvailable,
    ggufEnabled: !!(s.reranker && s.reranker.gguf && s.reranker.gguf.enabled),
    ggufReady: rerankerRuntime.isReady(),
    ggufUnavailableReason: providerStatus(embeddingsAvailable).unavailableReason,
  });
}

/**
 * Reranker status for the Retrieval Panel + System Health. Keeps the legacy fields (mode/label/reason) that
 * older UI reads, and adds the full honest provider status + the GGUF runtime status. Safe/redacted.
 */
export function status() {
  const s: any = settings.get();
  const d = decide(true); // legacy embedding-mode label assuming embeddings exist (common case)
  const ps = providerStatus(true);
  const pl = plan(true);
  const rt = rerankerRuntime.status();
  const legacyMode = pl.provider === 'gguf_reranker' ? 'cross_encoder' : pl.provider === 'embedding_similarity' ? 'embedding' : pl.provider === 'heuristic' ? 'heuristic' : 'disabled';
  return {
    enabled: !!s.rerankerEnabled,
    modelConfigured: safeExists(s.rerankerModelPath),
    mode: legacyMode,
    label: providerCore.displayName(pl.provider),
    reason: pl.reason,
    maxCandidates: Number(s.maxRerankCandidates) > 0 ? Number(s.maxRerankCandidates) : 20,
    // New honest provider model:
    providerStatus: ps,
    plan: pl,
    runtime: rt,
    topKInput: Number(s.reranker?.gguf?.topKInput) || 30,
    topKOutput: Number(s.reranker?.gguf?.topKOutput) || 8,
    provider: {
      crossEncoder: {
        available: ps.id === 'gguf_reranker' && ps.ready,
        status: ps.id === 'gguf_reranker' ? ps.statusLabel : 'NEEDS_SETUP',
        reason: ps.id === 'gguf_reranker' ? (ps.ready ? 'Local GGUF reranker via llama-server /rerank.' : providerCore.reasonLabel(ps.unavailableReason)) : 'Select the GGUF reranker provider + a reranker model to enable a real local cross-encoder.',
      },
      embeddingSimilarity: { available: true, status: 'READY', reason: 'Real local rerank by embedding cosine over the top candidates.' },
    },
  };
}

export default { decide, plan, providerStatus, status };
