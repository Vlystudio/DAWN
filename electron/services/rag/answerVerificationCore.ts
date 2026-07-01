/**
 * answerVerificationCore.ts — pure, electron-free groundedness checker. After DAWN answers using
 * retrieved local chunks, this scores each claim (sentence) against the retrieved evidence by salient-
 * token overlap and labels it supported / partially_supported / unsupported / not_enough_evidence.
 *
 * It is deliberately HONEST and conservative: it is a lexical overlap check, not an LLM judge, so it
 * never *claims* certainty it doesn't have — it flags what it cannot verify rather than asserting
 * support. Retrieved text is treated purely as data to compare against (never executed/obeyed), so
 * injection text inside a source can't do anything here.
 */
import { tokenize } from './hybridRetrievalCore';

export type Support = 'supported' | 'partially_supported' | 'unsupported' | 'not_enough_evidence';

export interface Evidence { id: string; name?: string; text: string; stale?: boolean }

export interface ClaimResult {
  claim: string;
  support: Support;
  coverage: number;          // fraction of the claim's salient tokens found in the best chunk [0,1]
  bestChunkId: string | null;
  bestChunkName?: string;
  staleSource: boolean;
}

export interface VerificationResult {
  claims: ClaimResult[];
  supported: number; partial: number; unsupported: number; notEnough: number;
  groundedness: number;      // mean coverage across checked claims [0,1]
  warning?: string;          // shown when some claims couldn't be verified
  method: string;            // honest label of how this was computed
}

/** Split an answer into claim sentences (drops tiny fragments). */
export function splitClaims(answer: string): string[] {
  return String(answer || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => tokenize(s).length >= 3); // need a few salient tokens to be a checkable claim
}

/** Coverage of a claim's salient tokens by a single chunk's tokens [0,1]. */
export function coverage(claim: string, chunkText: string): number {
  const cTok = Array.from(new Set(tokenize(claim)));
  if (!cTok.length) return 0;
  const dTok = new Set(tokenize(chunkText));
  let hit = 0; for (const t of cTok) if (dTok.has(t)) hit++;
  return hit / cTok.length;
}

const SUPPORTED_AT = 0.6;   // >= 60% of salient tokens present in one chunk → supported
const PARTIAL_AT = 0.3;     // >= 30% → partially supported

export function classify(cov: number, hasEvidence: boolean): Support {
  if (!hasEvidence) return 'not_enough_evidence';
  if (cov >= SUPPORTED_AT) return 'supported';
  if (cov >= PARTIAL_AT) return 'partially_supported';
  return 'unsupported';
}

/** Verify an answer against retrieved evidence chunks. Never fabricates support. */
export function verifyAnswer(answer: string, evidence: Evidence[]): VerificationResult {
  const claims = splitClaims(answer);
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  const results: ClaimResult[] = claims.map((claim) => {
    let best = { cov: 0, id: null as string | null, name: undefined as string | undefined, stale: false };
    for (const e of evidence || []) {
      const cov = coverage(claim, e.text);
      if (cov > best.cov) best = { cov, id: e.id, name: e.name, stale: !!e.stale };
    }
    return {
      claim, support: classify(best.cov, hasEvidence),
      coverage: Number(best.cov.toFixed(3)),
      bestChunkId: best.cov >= PARTIAL_AT ? best.id : null,
      bestChunkName: best.cov >= PARTIAL_AT ? best.name : undefined,
      staleSource: best.cov >= PARTIAL_AT && best.stale,
    };
  });
  const supported = results.filter((r) => r.support === 'supported').length;
  const partial = results.filter((r) => r.support === 'partially_supported').length;
  const unsupported = results.filter((r) => r.support === 'unsupported').length;
  const notEnough = results.filter((r) => r.support === 'not_enough_evidence').length;
  const groundedness = results.length ? Number((results.reduce((s, r) => s + r.coverage, 0) / results.length).toFixed(3)) : 0;
  let warning: string | undefined;
  if (!hasEvidence) warning = 'No local sources were retrieved — this answer is not grounded in your knowledge base.';
  else if (unsupported + notEnough > 0) warning = `${unsupported + notEnough} of ${results.length} statements could not be verified against your local sources.`;
  else if (results.some((r) => r.staleSource)) warning = 'Some supporting sources are marked stale — re-index to confirm.';
  return {
    claims: results, supported, partial, unsupported, notEnough, groundedness, warning,
    method: 'lexical overlap of salient tokens vs. retrieved chunks (deterministic; not an LLM judge)',
  };
}

/** A compact, safe summary line for the UI (no chunk text, no paths). */
export function summaryLine(v: VerificationResult): string {
  if (!v.claims.length) return 'No verifiable claims.';
  const parts = [`${v.supported} supported`];
  if (v.partial) parts.push(`${v.partial} partial`);
  if (v.unsupported) parts.push(`${v.unsupported} unverified`);
  if (v.notEnough) parts.push(`${v.notEnough} no evidence`);
  return `Grounding: ${parts.join(' · ')} (of ${v.claims.length}).`;
}

export default { splitClaims, coverage, classify, verifyAnswer, summaryLine };
