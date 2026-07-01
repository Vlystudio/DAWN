/**
 * entailment.ts — OPTIONAL local-model entailment verification (electron). Off by default. When on, it
 * routes to the DEDICATED HELPER RUNTIME if running, else the loaded chat model (if allowed), else the
 * conservative LEXICAL fallback. On any failure it returns support=null so the caller keeps the lexical
 * result. Never called with no evidence (missing evidence is never "supported"). Evidence is untrusted.
 */
import settings from '../settings';
import runtime from '../runtime';
import ecore from './entailmentCore';
import hmCore, { HelperProvider } from './helperModelCore';
import aid from './localModelAid';
import helperRuntime from './helperRuntime';
import type { Support } from './answerVerificationCore';

export interface EntailOut { support: Support | null; explanation?: string; mode: 'entailment' | 'lexical_fallback'; provider: HelperProvider; reason?: string }

export function enabled(): boolean { const s: any = settings.get(); return !!s.entailmentEnabled; }

export async function verifyClaim(claim: string, evidence: string): Promise<EntailOut> {
  const s: any = settings.get();
  if (!s.entailmentEnabled) return { support: null, mode: 'lexical_fallback', provider: 'none', reason: 'disabled' };
  if (!evidence || !evidence.trim()) return { support: null, mode: 'lexical_fallback', provider: 'lexical', reason: 'no evidence' };

  const res = hmCore.resolveHelperTask({
    task: 'entailment', taskEnabled: true,
    helperRuntimeEnabled: !!s.helperRuntime?.enabled,
    helperRuntimeReady: helperRuntime.isReady(),
    chatReady: runtime.isReady(),
    preferChatFallback: s.helperModels?.preferChatModelFallback !== false,
    lexicalFallback: true,
  });
  if (res.provider === 'none' || res.provider === 'lexical') return { support: null, mode: 'lexical_fallback', provider: res.provider, reason: res.reason };

  const prompt = ecore.buildEntailmentPrompt(claim, evidence);
  // Entailment is post-answer → LOW priority so it never starves latency-critical rewrite/HyDE.
  const r = res.provider === 'helper_runtime'
    ? await helperRuntime.runQueued('entailment', 'low', prompt, { maxTokens: 90 })
    : await aid.callModel(prompt, { timeoutMs: s.rewriteTimeoutMs || 8000, maxTokens: 90 });
  if (!r.ok) return { support: null, mode: 'lexical_fallback', provider: res.provider, reason: (r as any).reason };
  const parsed = ecore.parseEntailment(r.text || '');
  if (!parsed.support) return { support: null, mode: 'lexical_fallback', provider: res.provider, reason: 'unparseable' };
  return { support: parsed.support, explanation: parsed.explanation, mode: 'entailment', provider: res.provider };
}

export default { enabled, verifyClaim };
