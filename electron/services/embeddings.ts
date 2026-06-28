/**
 * embeddings.ts — fully-local embeddings for RAG.
 *
 * MVP: a deterministic hashed-token embedding (unigrams + bigrams -> 256-dim,
 * L2-normalized). Zero dependencies, always works offline, and gives decent
 * keyword-semantic retrieval. Upgrade path: a real GGUF embedding model served
 * by a second llama-server in `--embeddings` mode (kept behind this interface).
 */

const DIM = 256;

function bump(v: Float32Array, tok: string) {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) h = Math.imul(h ^ tok.charCodeAt(i), 16777619);
  v[(h >>> 0) % DIM] += 1;
}

export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM);
  const toks = String(text).toLowerCase().split(/\W+/).filter((t) => t.length > 1);
  for (let i = 0; i < toks.length; i++) {
    bump(v, toks[i]);
    if (i + 1 < toks.length) bump(v, toks[i] + '_' + toks[i + 1]);
  }
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

export async function embed(text: string): Promise<Float32Array> {
  return hashEmbed(text);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export default { embed, hashEmbed, cosine };
