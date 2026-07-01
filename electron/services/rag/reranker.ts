/**
 * reranker.ts — electron wrapper that picks the honest rerank mode from settings + real capability.
 * No cross-encoder ships, so `crossEncoderAvailable` is always false and DAWN never claims cross-encoder
 * reranking. The actual reordering is the pure `rerankerCore.rerank` applied by rag.retrieve over the
 * already-computed embedding scores. Vault/auth/audit content is never in the knowledge chunks, so it is
 * never reranked.
 */
import * as fs from 'fs';
import settings from '../settings';
import core, { RerankMode } from './rerankerCore';

function safeExists(p: string): boolean { try { return !!p && fs.existsSync(p); } catch { return false; } }

/** Decide the rerank mode for a query given whether embeddings are available in the candidate set. */
export function decide(embeddingsAvailable: boolean): { mode: RerankMode; reason: string } {
  const s: any = settings.get();
  return core.resolveRerankMode({
    enabled: !!s.rerankerEnabled,
    embeddingsAvailable,
    crossEncoderAvailable: false, // not shipped — never faked
    rerankerModelConfigured: safeExists(s.rerankerModelPath),
  });
}

/**
 * Reranker provider status. Cross-encoder is reported honestly as NEEDS_SETUP — DAWN does not bundle a
 * cross-encoder (onnxruntime-node is a heavy/brittle native dep to package; a GGUF reranker via a second
 * llama-server `--reranking` instance is the real future path, like the vision runtime). Today the real
 * local rerank is embedding-similarity; heuristic is the no-embeddings fallback. No fake scores.
 */
export function status() {
  const s: any = settings.get();
  const d = decide(true); // report the mode assuming embeddings exist (the common case)
  return {
    enabled: !!s.rerankerEnabled,
    modelConfigured: safeExists(s.rerankerModelPath),
    mode: s.rerankerEnabled ? d.mode : 'disabled',
    label: core.modeLabel(s.rerankerEnabled ? d.mode : 'disabled'),
    reason: d.reason,
    maxCandidates: Number(s.maxRerankCandidates) > 0 ? Number(s.maxRerankCandidates) : 20,
    provider: {
      crossEncoder: { available: false, status: 'NEEDS_SETUP', reason: 'No cross-encoder ships (onnxruntime-node not bundled; a GGUF reranker via a second llama-server is the real future path).' },
      embeddingSimilarity: { available: true, status: 'READY', reason: 'Real local rerank by embedding cosine over the top candidates.' },
    },
  };
}

export default { decide, status };
