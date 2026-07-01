/**
 * rerankerClientCore.ts — pure, electron-free shaping of the local reranker HTTP call. It builds the
 * request body from a query + candidate chunks (enforcing topKInput and maxCandidateChars) and parses the
 * server response into structured, honest scores. It handles the messy real cases without ever inventing a
 * score: malformed body, missing `results`, out-of-range index, non-numeric score, and length mismatch.
 *
 * The electron `rerankerRuntime` does the actual fetch; this module has NO I/O, so its logic is fully
 * unit-testable with mock JSON. It returns ids + numbers only — never logs or returns candidate text.
 */

export interface RerankBuildCfg { topKInput: number; maxCandidateChars: number }
export interface RerankCandidateIn { id: string; text: string }
export interface RerankRequestBuilt { query: string; documents: string[]; ids: string[]; inputCount: number }

function truncate(s: string, max: number): string {
  const str = String(s || '');
  return str.length > max ? str.slice(0, max) : str;
}

/**
 * Build the /rerank request: take the top `topKInput` candidates in the given (hybrid) order, truncate each
 * document to `maxCandidateChars`, and keep a parallel id list so results can be mapped back by index. The
 * query is sent as-is to the LOCAL reranker only. Pure.
 */
export function buildRerankRequest(query: string, candidates: RerankCandidateIn[], cfg: RerankBuildCfg): RerankRequestBuilt {
  const topK = cfg.topKInput > 0 ? Math.floor(cfg.topKInput) : 30;
  const maxChars = cfg.maxCandidateChars > 0 ? Math.floor(cfg.maxCandidateChars) : 4000;
  const head = (candidates || []).slice(0, topK);
  return {
    query: String(query || ''),
    documents: head.map((c) => truncate(c.text, maxChars)),
    ids: head.map((c) => c.id),
    inputCount: head.length,
  };
}

export interface RerankScored { id: string; score: number | null }
export interface ParseResult {
  ok: boolean;
  scores: RerankScored[] | null;
  validCount: number;
  lengthMismatch: boolean;
  reason?: string;
}

/**
 * Parse a llama-server /rerank (or OpenAI-/Cohere-shaped) response into per-id scores, mapped back by the
 * `index` field to the request's id list. Honest failure modes:
 *   - not an object / no results array           → { ok:false, reason:'malformed' }
 *   - results present but no valid numeric score  → { ok:false, reason:'no_valid_scores' }
 *   - some ids missing a score                    → ok:true, those ids get score:null (kept, not faked)
 *   - results length != documents length          → ok (if any valid) with lengthMismatch:true
 * Never fabricates a score. Pure.
 */
export function parseRerankResponse(raw: any, ids: string[]): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'malformed' };
  const results: any[] | null = Array.isArray(raw.results) ? raw.results
    : Array.isArray(raw.data) ? raw.data
    : null;
  if (!results) return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'malformed' };

  const byId = new Map<string, number>();
  let seen = 0;
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    seen++;
    const idx = Number(r.index);
    const raw2 = r.relevance_score ?? r.score ?? r.relevanceScore;
    const score = Number(raw2);
    if (!Number.isInteger(idx) || idx < 0 || idx >= ids.length) continue; // out of range → ignore honestly
    if (!isFinite(score)) continue;                                        // non-numeric → ignore honestly
    byId.set(ids[idx], score);
  }

  const scores: RerankScored[] = ids.map((id) => ({ id, score: byId.has(id) ? (byId.get(id) as number) : null }));
  const validCount = byId.size;
  const lengthMismatch = seen !== ids.length;
  if (validCount === 0) return { ok: false, scores: null, validCount: 0, lengthMismatch, reason: 'no_valid_scores' };
  return { ok: true, scores, validCount, lengthMismatch, reason: lengthMismatch ? 'length_mismatch' : undefined };
}

/** Map an HTTP status from the reranker endpoint to an honest unavailable reason. */
export function httpStatusReason(status: number): string {
  if (status === 404 || status === 405 || status === 501) return 'unavailable_api_not_supported';
  if (status === 503) return 'unavailable_runtime_not_ready';
  return 'unavailable_server_error';
}

export default { buildRerankRequest, parseRerankResponse, httpStatusReason };
