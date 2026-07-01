/**
 * queryExpansionCore.ts — pure, electron-free core for LOCAL query rewriting + HyDE expansion. It only
 * builds prompts and parses/sanitizes model output; the electron wrapper injects the actual local-model
 * call (with a timeout) and handles fallback. Model output here is used ONLY as a retrieval aid — extra
 * query strings (rewrite) or a synthetic passage embedded to widen vector recall (HyDE). It is never
 * evidence, never cited, never obeyed. All parsing is defensive: malformed output degrades to nothing.
 */

const MAX_Q_LEN = 200;

export function buildRewritePrompt(query: string, maxVariants: number): string {
  const n = Math.max(1, Math.min(5, maxVariants || 2));
  return [
    'You rewrite a search query into alternative search queries for a LOCAL knowledge base.',
    `Give up to ${n} short alternative queries that would find the same information (synonyms, expansions, rephrasings).`,
    'Output ONLY the queries, one per line. No numbering, no commentary, no quotes.',
    `Query: ${String(query || '').slice(0, MAX_Q_LEN)}`,
  ].join('\n');
}

/** Parse model output into clean query variants (deduped, capped, original excluded). Never throws. */
export function parseRewrite(output: string, original: string, maxVariants: number): { variants: string[]; keywords: string[] } {
  const n = Math.max(1, Math.min(5, maxVariants || 2));
  const orig = String(original || '').trim().toLowerCase();
  const seen = new Set<string>([orig]);
  const variants: string[] = [];
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    let line = rawLine.trim()
      .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '') // strip list markers
      .replace(/^["'`]|["'`]$/g, '')           // strip wrapping quotes
      .trim();
    if (!line || line.length < 2 || line.length > MAX_Q_LEN) continue;
    if (/^(query|queries|here are|output|sure|okay|alternative)/i.test(line)) continue; // drop instruction echoes
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(line);
    if (variants.length >= n) break;
  }
  const keywords = Array.from(new Set(
    [original, ...variants].join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  )).slice(0, 24);
  return { variants, keywords };
}

export function buildHydePrompt(query: string): string {
  return [
    'Write a short hypothetical passage (2-3 sentences) that could directly answer the question, as if',
    'excerpted from a reference document. Be concrete and specific. No preamble, no disclaimers.',
    `Question: ${String(query || '').slice(0, MAX_Q_LEN)}`,
  ].join('\n');
}

/** Clean HyDE output for use as an embedding aid: strip control chars, collapse whitespace, cap length. */
export function sanitizeHyde(output: string, maxLen = 500): string {
  const NUL = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');
  const t = String(output || '').replace(NUL, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, Math.max(0, maxLen));
}

/** The keyword query to search with: original + variants (deduped), joined. */
export function combinedKeywordQuery(original: string, variants: string[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const q of [original, ...(variants || [])]) {
    const t = String(q || '').trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); parts.push(t); }
  }
  return parts.join(' ');
}

export default { buildRewritePrompt, parseRewrite, buildHydePrompt, sanitizeHyde, combinedKeywordQuery };
