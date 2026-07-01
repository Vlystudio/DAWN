/**
 * ragEvalCore.ts — pure, electron-free evaluation core for DAWN's local retrieval + grounded answers.
 * Given a fixed eval dataset (question + a small synthetic corpus + expectations), it measures REAL
 * metrics using the same retrieval (hybridRank) and verification (verifyAnswer) cores DAWN ships — no
 * model, no live index, fully deterministic, so it doubles as a regression test. Missing expectations
 * make a case INVALID (not a silent pass); scores are never fabricated.
 */
import { hybridRank, tokenize } from './hybridRetrievalCore';
import { verifyAnswer } from './answerVerificationCore';

export interface EvalDoc { id: string; name: string; text: string }
export interface EvalCase {
  id: string;
  question: string;
  corpus: EvalDoc[];
  expectedSourceIds?: string[];  // ids that SHOULD be retrieved
  expectedKeywords?: string[];   // keywords a grounded answer should contain
  answer?: string;               // a candidate answer to verify offline
  negativeClaims?: string[];     // statements that should NOT be supported by the corpus
  notes?: string;
}

export interface CaseScore {
  id: string;
  valid: boolean;
  invalidReason?: string;
  retrievalHit: boolean | null;   // expected source in topK
  topKHit: boolean | null;        // expected source in top-1
  mode: string | null;
  keywordCoverage: number | null; // fraction of expectedKeywords present in answer
  groundedness: number | null;    // from verifyAnswer
  unsupportedRate: number | null;
  negativesLeaked: number | null; // negative claims that were (wrongly) marked supported
}

export function scoreCase(c: EvalCase, topK = 5): CaseScore {
  const nothingToMeasure = !(c.expectedSourceIds?.length) && !(c.expectedKeywords?.length) && !c.answer;
  if (!c || !c.question || !Array.isArray(c.corpus) || c.corpus.length === 0 || nothingToMeasure) {
    return { id: c?.id || '?', valid: false, invalidReason: 'missing question/corpus/expectations', retrievalHit: null, topKHit: null, mode: null, keywordCoverage: null, groundedness: null, unsupportedRate: null, negativesLeaked: null };
  }
  const { mode, results } = hybridRank(
    c.corpus.map((d) => ({ id: d.id, name: d.name, text: d.text, vectorScore: null })),
    c.question, { topK }
  );
  const ids = results.map((r) => r.id);
  const retrievalHit = c.expectedSourceIds?.length ? c.expectedSourceIds.some((id) => ids.includes(id)) : null;
  const topKHit = c.expectedSourceIds?.length ? (ids[0] ? c.expectedSourceIds.includes(ids[0]) : false) : null;

  let keywordCoverage: number | null = null;
  if (c.expectedKeywords?.length && c.answer) {
    const aTok = new Set(tokenize(c.answer));
    const hit = c.expectedKeywords.filter((k) => tokenize(k).every((t) => aTok.has(t))).length;
    keywordCoverage = Number((hit / c.expectedKeywords.length).toFixed(3));
  }

  let groundedness: number | null = null;
  let unsupportedRate: number | null = null;
  let negativesLeaked: number | null = null;
  if (c.answer) {
    const v = verifyAnswer(c.answer, c.corpus.map((d) => ({ id: d.id, name: d.name, text: d.text })));
    groundedness = v.groundedness;
    unsupportedRate = v.claims.length ? Number(((v.unsupported + v.notEnough) / v.claims.length).toFixed(3)) : 0;
  }
  if (c.negativeClaims?.length) {
    const v = verifyAnswer(c.negativeClaims.join(' '), c.corpus.map((d) => ({ id: d.id, name: d.name, text: d.text })));
    negativesLeaked = v.supported; // negatives that got wrongly marked supported (should be 0)
  }
  return { id: c.id, valid: true, retrievalHit, topKHit, mode, keywordCoverage, groundedness, unsupportedRate, negativesLeaked };
}

export interface EvalSummary {
  cases: number; valid: number; invalid: number;
  retrievalHitRate: number | null;
  top1HitRate: number | null;
  meanKeywordCoverage: number | null;
  meanGroundedness: number | null;
  meanUnsupportedRate: number | null;
  negativesLeaked: number;
  ranAt: number;
}

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Number((v.reduce((s, x) => s + x, 0) / v.length).toFixed(3)) : null;
}

export function runEval(cases: EvalCase[], topK = 5): { summary: EvalSummary; scores: CaseScore[] } {
  const scores = (cases || []).map((c) => scoreCase(c, topK));
  const valid = scores.filter((s) => s.valid);
  const rHits = valid.map((s) => s.retrievalHit).filter((x): x is boolean => x !== null);
  const t1Hits = valid.map((s) => s.topKHit).filter((x): x is boolean => x !== null);
  const summary: EvalSummary = {
    cases: scores.length, valid: valid.length, invalid: scores.length - valid.length,
    retrievalHitRate: rHits.length ? Number((rHits.filter(Boolean).length / rHits.length).toFixed(3)) : null,
    top1HitRate: t1Hits.length ? Number((t1Hits.filter(Boolean).length / t1Hits.length).toFixed(3)) : null,
    meanKeywordCoverage: mean(valid.map((s) => s.keywordCoverage)),
    meanGroundedness: mean(valid.map((s) => s.groundedness)),
    meanUnsupportedRate: mean(valid.map((s) => s.unsupportedRate)),
    negativesLeaked: valid.reduce((s, x) => s + (x.negativesLeaked || 0), 0),
    ranAt: Date.now(),
  };
  return { summary, scores };
}

export default { scoreCase, runEval };
