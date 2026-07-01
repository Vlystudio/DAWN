/**
 * entailment.ts — OPTIONAL local-model entailment verification (electron). Off by default. When on, it
 * asks the local model whether the evidence supports a claim; on ANY failure (model off, timeout,
 * unparseable) it returns support=null so the caller keeps the conservative lexical result. It never
 * calls the model when there is no evidence (missing evidence is never "supported"), and evidence is
 * passed as untrusted data.
 */
import settings from '../settings';
import ecore from './entailmentCore';
import aid from './localModelAid';
import type { Support } from './answerVerificationCore';

export interface EntailOut { support: Support | null; explanation?: string; mode: 'entailment' | 'lexical_fallback'; reason?: string }

export function enabled(): boolean { const s: any = settings.get(); return !!s.entailmentEnabled; }

export async function verifyClaim(claim: string, evidence: string): Promise<EntailOut> {
  const s: any = settings.get();
  if (!s.entailmentEnabled) return { support: null, mode: 'lexical_fallback', reason: 'disabled' };
  if (!evidence || !evidence.trim()) return { support: null, mode: 'lexical_fallback', reason: 'no evidence' };
  const r = await aid.callModel(ecore.buildEntailmentPrompt(claim, evidence), { timeoutMs: s.rewriteTimeoutMs || 8000, maxTokens: 90 });
  if (!r.ok) return { support: null, mode: 'lexical_fallback', reason: r.reason };
  const parsed = ecore.parseEntailment(r.text || '');
  if (!parsed.support) return { support: null, mode: 'lexical_fallback', reason: 'unparseable' };
  return { support: parsed.support, explanation: parsed.explanation, mode: 'entailment' };
}

export default { enabled, verifyClaim };
