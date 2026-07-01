/**
 * rerankerCore.ts — pure, electron-free reranking stage that runs AFTER hybrid retrieval. It never
 * fakes a cross-encoder: it honestly picks the strongest LOCAL path available and labels it.
 *
 *   disabled       — rerank stage off; hybrid (RRF) order kept.
 *   heuristic      — fallback: hybrid order kept (used when embeddings unavailable).
 *   embedding      — re-order the top candidates by pure embedding cosine similarity (real, local).
 *   cross_encoder  — ONLY if a real cross-encoder is actually available (not shipped → never claimed).
 *
 * Every result carries a score trace (hybridScore / rerankScore / finalScore) so nothing is opaque.
 */

export type RerankMode = 'disabled' | 'heuristic' | 'embedding' | 'cross_encoder' | 'failed';

export interface RerankInputs {
  enabled: boolean;
  embeddingsAvailable: boolean;
  crossEncoderAvailable: boolean;   // a real cross-encoder is loaded (currently always false — not shipped)
  rerankerModelConfigured: boolean; // rerankerModelPath is set
}
export interface RerankDecision { mode: RerankMode; reason: string }

/** Decide the rerank mode honestly from real capability inputs. */
export function resolveRerankMode(i: RerankInputs): RerankDecision {
  if (!i.enabled) return { mode: 'disabled', reason: 'Reranker disabled — hybrid (RRF) ranking kept.' };
  if (i.crossEncoderAvailable) return { mode: 'cross_encoder', reason: 'Local cross-encoder reranker.' };
  if (i.rerankerModelConfigured && !i.crossEncoderAvailable && i.embeddingsAvailable)
    return { mode: 'embedding', reason: 'A reranker model is configured but cross-encoder inference is not wired; using embedding-similarity rerank.' };
  if (i.embeddingsAvailable) return { mode: 'embedding', reason: 'Embedding-similarity rerank of the top candidates.' };
  return { mode: 'heuristic', reason: 'No embeddings available — hybrid (RRF + title boost) ranking kept.' };
}

export interface RerankItem { id: string; hybridScore: number; vectorScore?: number | null }
export interface RerankedItem { id: string; hybridScore: number; rerankScore: number | null; finalScore: number }

function minMaxNorm(vals: number[]): (v: number) => number {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (!isFinite(lo) || !isFinite(hi) || hi === lo) return () => (vals.length ? 1 : 0);
  return (v) => (v - lo) / (hi - lo);
}

/**
 * Apply the rerank. For 'embedding', reorders the top `maxCandidates` by vectorScore (falling back to
 * heuristic for any item lacking a vector). For 'disabled'/'heuristic', keeps hybrid order. Pure.
 */
export function rerank(items: RerankItem[], mode: RerankMode, maxCandidates = 20): RerankedItem[] {
  const head = items.slice(0, Math.max(1, maxCandidates));
  if (mode === 'embedding' && head.some((x) => typeof x.vectorScore === 'number')) {
    const norm = minMaxNorm(head.map((x) => (typeof x.vectorScore === 'number' ? (x.vectorScore as number) : -1)));
    return head
      .map((x) => ({ id: x.id, hybridScore: x.hybridScore, rerankScore: typeof x.vectorScore === 'number' ? Number(norm(x.vectorScore as number).toFixed(3)) : null }))
      .sort((a, b) => (b.rerankScore ?? -1) - (a.rerankScore ?? -1))
      .map((x) => ({ ...x, finalScore: x.rerankScore ?? x.hybridScore }));
  }
  // disabled / heuristic / failed → keep hybrid order, final = hybrid.
  return head.map((x) => ({ id: x.id, hybridScore: x.hybridScore, rerankScore: null, finalScore: x.hybridScore }));
}

/** Human label for System Health / debug UI. */
export function modeLabel(mode: RerankMode): string {
  switch (mode) {
    case 'disabled': return 'Disabled';
    case 'heuristic': return 'Heuristic (hybrid RRF)';
    case 'embedding': return 'Embedding similarity';
    case 'cross_encoder': return 'Cross-encoder';
    case 'failed': return 'Failed (fell back)';
    default: return 'Unknown';
  }
}

export default { resolveRerankMode, rerank, modeLabel };
