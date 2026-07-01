/**
 * queryExpansion.ts — LOCAL query rewrite + HyDE expansion (electron). Off by default. When enabled it
 * routes to the DEDICATED HELPER RUNTIME if it's running, else the loaded chat model (if allowed), else
 * skips — with clear provenance on every result (helper_runtime / chat / none). Rewrites/HyDE are
 * retrieval aids only: never evidence, never cited, never obeyed. Raw model output is not logged.
 */
import settings from '../settings';
import logger from '../logger';
import runtime from '../runtime';
import core from './queryExpansionCore';
import hmCore, { HelperProvider } from './helperModelCore';
import aid from './localModelAid';
import helperRuntime from './helperRuntime';
import helperQueue from './helperQueue';
import analytics, { statusFor } from './helperAnalyticsCore';
import adaptiveRouting from './adaptiveRouting';
import type { AdaptiveDecision } from './adaptiveRoutingCore';

interface RouteOut { ok: boolean; text?: string; provider: HelperProvider; reason?: string; status?: string; queueWaitMs?: number; runMs?: number; adaptive?: AdaptiveDecision | null }

/**
 * Route one helper prompt: dedicated runtime (via the QUEUE, high priority) → chat model → skip. When
 * adaptive routing is enabled AND the analytics say the helper is slow/timeout/failure-prone for this
 * role, it re-resolves with the helper EXCLUDED (honest fallback), then probes + routes back on recovery.
 * Every result carries provenance + status + the adaptive decision (evidence only, no private text).
 */
async function routeHelper(task: 'query_rewrite' | 'hyde', prompt: string, opts: { maxTokens?: number }): Promise<RouteOut> {
  const s: any = settings.get();
  const role = task === 'query_rewrite' ? 'query_rewriter' : 'hyde_generator';
  const resolve = (helperReady: boolean) => hmCore.resolveHelperTask({
    task, taskEnabled: true, helperRuntimeEnabled: !!s.helperRuntime?.enabled, helperRuntimeReady: helperReady,
    chatReady: runtime.isReady(), preferChatFallback: s.helperModels?.preferChatModelFallback !== false, lexicalFallback: false,
  });
  let res = resolve(helperRuntime.isReady());
  let adaptive: AdaptiveDecision | null = null;
  if (res.provider === 'helper_runtime' && adaptiveRouting.enabled() && adaptiveRouting.appliesTo(role as any)) {
    adaptive = adaptiveRouting.decisionFor(role as any);         // ADVANCES hysteresis state
    if (!adaptive.preferHelper) res = resolve(false);            // steer away → honest fallback chain (helper excluded)
  }
  if (res.provider === 'helper_runtime') {
    const q = await helperRuntime.runQueued(task, 'high', prompt, opts); // rewrite + HyDE are latency-critical
    return { ok: q.ok, text: q.text, provider: 'helper_runtime', reason: q.reason, status: q.status, queueWaitMs: q.queueWaitMs, runMs: q.runMs, adaptive };
  }
  if (res.provider === 'chat') { const r = await aid.callModel(prompt, { timeoutMs: s.rewriteTimeoutMs || 8000, ...opts }); return { ok: r.ok, text: r.text, provider: 'chat', reason: r.reason, status: r.ok ? 'completed' : 'fallback', adaptive }; }
  return { ok: false, provider: res.provider, reason: res.reason, status: 'skipped', adaptive };
}

export interface RewriteResult { queries: string[]; variants: string[]; keywords: string[]; mode: 'rewritten' | 'disabled' | 'fallback'; provider: HelperProvider; reason?: string; status?: string; queueWaitMs?: number; runMs?: number; adaptive?: AdaptiveDecision | null }

export async function rewrite(query: string): Promise<RewriteResult> {
  const s: any = settings.get();
  const base = { queries: [query], variants: [] as string[], keywords: [] as string[] };
  if (!s.queryRewriteEnabled) return { ...base, mode: 'disabled', provider: 'none', status: 'skipped' };
  const r = await routeHelper('query_rewrite', core.buildRewritePrompt(query, s.maxRewriteQueries || 2), { maxTokens: 120 });
  try { analytics.record({ role: 'query_rewriter', provider: r.provider as any, status: statusFor(r.provider as any, r.ok, r.status), queueWaitMs: r.queueWaitMs, runMs: r.runMs, reason: r.reason, generation: helperQueue.generation }); } catch { /* analytics must never break retrieval */ }
  const meta = { provider: r.provider, reason: r.reason, status: r.status, queueWaitMs: r.queueWaitMs, runMs: r.runMs, adaptive: r.adaptive };
  if (!r.ok) { logger.info('rag', `query rewrite fallback (provider=${r.provider}, status=${r.status}, ${r.reason})`); return { ...base, mode: 'fallback', ...meta }; }
  const parsed = core.parseRewrite(r.text || '', query, s.maxRewriteQueries || 2);
  if (!parsed.variants.length) return { ...base, mode: 'fallback', ...meta, reason: 'no usable variants' };
  return { queries: [query, ...parsed.variants], variants: parsed.variants, keywords: parsed.keywords, mode: 'rewritten', ...meta };
}

export interface HydeResult { text: string | null; mode: 'hyde' | 'disabled' | 'fallback'; provider: HelperProvider; reason?: string; status?: string; queueWaitMs?: number; runMs?: number; adaptive?: AdaptiveDecision | null }

export async function hyde(query: string): Promise<HydeResult> {
  const s: any = settings.get();
  if (!s.hydeEnabled) return { text: null, mode: 'disabled', provider: 'none', status: 'skipped' };
  const r = await routeHelper('hyde', core.buildHydePrompt(query), { maxTokens: 160 });
  try { analytics.record({ role: 'hyde_generator', provider: r.provider as any, status: statusFor(r.provider as any, r.ok, r.status), queueWaitMs: r.queueWaitMs, runMs: r.runMs, reason: r.reason, generation: helperQueue.generation }); } catch { /* */ }
  const meta = { provider: r.provider, reason: r.reason, status: r.status, queueWaitMs: r.queueWaitMs, runMs: r.runMs, adaptive: r.adaptive };
  if (!r.ok) { logger.info('rag', `HyDE fallback (provider=${r.provider}, status=${r.status}, ${r.reason})`); return { text: null, mode: 'fallback', ...meta }; }
  const t = core.sanitizeHyde(r.text || '');
  return t ? { text: t, mode: 'hyde', ...meta } : { text: null, mode: 'fallback', ...meta, reason: 'empty' };
}

/**
 * Eval-only variants: run rewrite / HyDE regardless of the feature toggle so the LIVE-INDEX eval can
 * measure those strategies honestly (routing helper_runtime → chat → skip exactly as production would).
 * They do NOT record helper analytics, so an explicit eval run never pollutes adaptive-routing stats.
 * Raw model output is not logged; only the parsed variants / hypothetical doc are returned.
 */
export async function rewriteForEval(query: string): Promise<RewriteResult> {
  const s: any = settings.get();
  const base = { queries: [query], variants: [] as string[], keywords: [] as string[] };
  const r = await routeHelper('query_rewrite', core.buildRewritePrompt(query, s.maxRewriteQueries || 2), { maxTokens: 120 });
  const meta = { provider: r.provider, reason: r.reason, status: r.status, queueWaitMs: r.queueWaitMs, runMs: r.runMs, adaptive: r.adaptive };
  if (!r.ok) return { ...base, mode: 'fallback', ...meta };
  const parsed = core.parseRewrite(r.text || '', query, s.maxRewriteQueries || 2);
  if (!parsed.variants.length) return { ...base, mode: 'fallback', ...meta, reason: 'no usable variants' };
  return { queries: [query, ...parsed.variants], variants: parsed.variants, keywords: parsed.keywords, mode: 'rewritten', ...meta };
}

export async function hydeForEval(query: string): Promise<HydeResult> {
  const r = await routeHelper('hyde', core.buildHydePrompt(query), { maxTokens: 160 });
  const meta = { provider: r.provider, reason: r.reason, status: r.status, queueWaitMs: r.queueWaitMs, runMs: r.runMs, adaptive: r.adaptive };
  if (!r.ok) return { text: null, mode: 'fallback', ...meta };
  const t = core.sanitizeHyde(r.text || '');
  return t ? { text: t, mode: 'hyde', ...meta } : { text: null, mode: 'fallback', ...meta, reason: 'empty' };
}

export default { rewrite, hyde, rewriteForEval, hydeForEval };
