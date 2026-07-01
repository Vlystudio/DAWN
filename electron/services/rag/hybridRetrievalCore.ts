/**
 * hybridRetrievalCore.ts — pure, electron-free core for DAWN's hybrid local retrieval. It combines
 * VECTOR candidates (cosine over local embeddings, computed by the caller) with a real KEYWORD signal
 * (BM25 over the candidate chunk text) and fuses them with Reciprocal Rank Fusion. It is honest about
 * mode: hybrid (both), vector-only, keyword-only, or unavailable — and it never invents scores.
 *
 * No DB, no embeddings model here: the electron layer fetches candidate chunks (already filtered to
 * safe, non-skipped/removed sources) + optional per-chunk vector scores, and this module ranks them.
 * Stale chunks may be included but are flagged so the UI/citation can label them.
 */

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'by', 'with', 'as', 'at', 'it', 'this', 'that', 'from', 'you', 'your', 'i', 'we', 'they', 'he', 'she', 'do', 'does', 'how', 'what', 'when', 'where', 'why', 'which', 'who']);

export function tokenize(s: string): string[] {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));
}

export interface Candidate {
  id: string;
  name?: string;
  text: string;
  vectorScore?: number | null; // cosine in [-1,1] or null if this chunk has no embedding
  stale?: boolean;
}

export type RetrievalMode = 'hybrid' | 'vector' | 'keyword' | 'unavailable';

export interface Ranked {
  id: string; name?: string; text: string;
  score: number;            // final normalized [0,1]
  vectorRank: number | null;
  keywordRank: number | null;
  keywordScore: number;     // raw BM25 (0 if no keyword hit)
  vectorScore: number | null;
  stale: boolean;
  titleBoosted: boolean;
}

/** BM25 over the candidate set (the candidates ARE the corpus for IDF). Returns raw score per id. */
export function bm25(query: string, docs: { id: string; text: string }[], k1 = 1.5, b = 0.75): Map<string, number> {
  const qTerms = Array.from(new Set(tokenize(query)));
  const scores = new Map<string, number>();
  if (!qTerms.length || !docs.length) return scores;
  const docTokens = docs.map((d) => ({ id: d.id, toks: tokenize(d.text) }));
  const N = docTokens.length;
  const avgdl = docTokens.reduce((s, d) => s + d.toks.length, 0) / (N || 1) || 1;
  // document frequency per query term
  const df = new Map<string, number>();
  for (const term of qTerms) {
    let n = 0;
    for (const d of docTokens) if (d.toks.includes(term)) n++;
    df.set(term, n);
  }
  for (const d of docTokens) {
    let score = 0;
    const dl = d.toks.length || 1;
    for (const term of qTerms) {
      const n = df.get(term) || 0;
      if (n === 0) continue;
      let tf = 0; for (const t of d.toks) if (t === term) tf++;
      if (!tf) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl))));
    }
    if (score > 0) scores.set(d.id, score);
  }
  return scores;
}

/** Reciprocal Rank Fusion of several ordered id-lists. */
export function rrf(rankings: string[][], k = 60): Map<string, number> {
  const out = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => { out.set(id, (out.get(id) || 0) + 1 / (k + i + 1)); });
  }
  return out;
}

function minMax(vals: number[]): (v: number) => number {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (!isFinite(lo) || !isFinite(hi) || hi === lo) return () => (vals.length ? 1 : 0);
  return (v: number) => (v - lo) / (hi - lo);
}

export interface HybridOpts { topK: number; titleBoost?: number; stalePenalty?: number }

/**
 * Rank candidates with hybrid fusion. Dedupes by id (first wins). Vector ranking uses provided cosine
 * scores; keyword ranking uses BM25 over candidate text. Both present → RRF fusion (hybrid). Only one
 * present → that one (labeled honestly). Title/name exact-token match gets a small boost; stale chunks
 * get a penalty but are kept + flagged.
 */
export function hybridRank(cands: Candidate[], query: string, opts: HybridOpts): { mode: RetrievalMode; results: Ranked[] } {
  // dedupe by id
  const seen = new Set<string>();
  const uniq = cands.filter((c) => (c.id && !seen.has(c.id)) ? (seen.add(c.id), true) : false);
  if (!uniq.length) return { mode: 'unavailable', results: [] };

  const withVec = uniq.filter((c) => typeof c.vectorScore === 'number' && isFinite(c.vectorScore as number));
  const vectorOrder = [...withVec].sort((a, b) => (b.vectorScore as number) - (a.vectorScore as number)).map((c) => c.id);

  const kwMap = bm25(query, uniq.map((c) => ({ id: c.id, text: c.text })));
  const keywordOrder = Array.from(kwMap.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const hasVector = vectorOrder.length > 0;
  const hasKeyword = keywordOrder.length > 0;
  let mode: RetrievalMode;
  let fused: Map<string, number>;
  if (hasVector && hasKeyword) { mode = 'hybrid'; fused = rrf([vectorOrder, keywordOrder]); }
  else if (hasVector) { mode = 'vector'; fused = rrf([vectorOrder]); }
  else if (hasKeyword) { mode = 'keyword'; fused = rrf([keywordOrder]); }
  else return { mode: 'unavailable', results: [] };

  const qTerms = new Set(tokenize(query));
  const titleBoost = opts.titleBoost ?? 0.05;
  const stalePenalty = opts.stalePenalty ?? 0.1;
  const vRank = new Map(vectorOrder.map((id, i) => [id, i]));
  const kRank = new Map(keywordOrder.map((id, i) => [id, i]));

  let scored = uniq
    .filter((c) => fused.has(c.id))
    .map((c) => {
      const nameToks = tokenize(c.name || '');
      const titleHit = nameToks.length > 0 && nameToks.some((t) => qTerms.has(t));
      let s = fused.get(c.id)!;
      if (titleHit) s += titleBoost;
      if (c.stale) s -= stalePenalty * s;
      return {
        c, raw: s, titleHit,
        vr: vRank.has(c.id) ? vRank.get(c.id)! : null,
        kr: kRank.has(c.id) ? kRank.get(c.id)! : null,
      };
    });

  const norm = minMax(scored.map((x) => x.raw));
  const results: Ranked[] = scored
    .sort((a, b) => b.raw - a.raw)
    .slice(0, Math.max(1, opts.topK))
    .map((x) => ({
      id: x.c.id, name: x.c.name, text: x.c.text,
      score: Number(norm(x.raw).toFixed(3)),
      vectorRank: x.vr === null ? null : x.vr + 1,
      keywordRank: x.kr === null ? null : x.kr + 1,
      keywordScore: Number((kwMap.get(x.c.id) || 0).toFixed(3)),
      vectorScore: typeof x.c.vectorScore === 'number' ? Number((x.c.vectorScore as number).toFixed(3)) : null,
      stale: !!x.c.stale,
      titleBoosted: x.titleHit,
    }));
  return { mode, results };
}

/** Honest human-readable reason for the active retrieval mode. */
export function modeReason(mode: RetrievalMode, embeddedChunks: number, totalChunks: number): string {
  switch (mode) {
    case 'hybrid': return 'Hybrid: vector (local embeddings) + BM25 keyword, fused with reciprocal-rank fusion.';
    case 'vector': return 'Vector only: embeddings present but no keyword matches for this query.';
    case 'keyword': return embeddedChunks === 0
      ? `Keyword only (BM25): no embeddings yet (${totalChunks} chunk(s) indexed) — index with an embedding model for hybrid.`
      : 'Keyword only (BM25): no vector candidates matched for this query.';
    default: return 'Unavailable: nothing indexed to search.';
  }
}

export default { tokenize, bm25, rrf, hybridRank, modeReason };
