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

/** Route one helper prompt to the dedicated runtime, else the chat model, else skip. Honest provenance. */
async function routeHelper(task: 'query_rewrite' | 'hyde', prompt: string, opts: { maxTokens?: number }): Promise<{ ok: boolean; text?: string; provider: HelperProvider; reason?: string }> {
  const s: any = settings.get();
  const res = hmCore.resolveHelperTask({
    task, taskEnabled: true, // callers only route when the task is enabled
    helperRuntimeEnabled: !!s.helperRuntime?.enabled,
    helperRuntimeReady: helperRuntime.isReady(),
    chatReady: runtime.isReady(),
    preferChatFallback: s.helperModels?.preferChatModelFallback !== false,
    lexicalFallback: false,
  });
  if (res.provider === 'helper_runtime') { const r = await helperRuntime.callHelper(prompt, opts); return { ok: r.ok, text: r.text, provider: 'helper_runtime', reason: r.reason }; }
  if (res.provider === 'chat') { const r = await aid.callModel(prompt, { timeoutMs: s.rewriteTimeoutMs || 8000, ...opts }); return { ok: r.ok, text: r.text, provider: 'chat', reason: r.reason }; }
  return { ok: false, provider: res.provider, reason: res.reason };
}

export interface RewriteResult { queries: string[]; variants: string[]; keywords: string[]; mode: 'rewritten' | 'disabled' | 'fallback'; provider: HelperProvider; reason?: string }

export async function rewrite(query: string): Promise<RewriteResult> {
  const s: any = settings.get();
  const base = { queries: [query], variants: [] as string[], keywords: [] as string[] };
  if (!s.queryRewriteEnabled) return { ...base, mode: 'disabled', provider: 'none' };
  const r = await routeHelper('query_rewrite', core.buildRewritePrompt(query, s.maxRewriteQueries || 2), { maxTokens: 120 });
  if (!r.ok) { logger.info('rag', `query rewrite fallback (provider=${r.provider}, ${r.reason})`); return { ...base, mode: 'fallback', provider: r.provider, reason: r.reason }; }
  const parsed = core.parseRewrite(r.text || '', query, s.maxRewriteQueries || 2);
  if (!parsed.variants.length) return { ...base, mode: 'fallback', provider: r.provider, reason: 'no usable variants' };
  return { queries: [query, ...parsed.variants], variants: parsed.variants, keywords: parsed.keywords, mode: 'rewritten', provider: r.provider };
}

export interface HydeResult { text: string | null; mode: 'hyde' | 'disabled' | 'fallback'; provider: HelperProvider; reason?: string }

export async function hyde(query: string): Promise<HydeResult> {
  const s: any = settings.get();
  if (!s.hydeEnabled) return { text: null, mode: 'disabled', provider: 'none' };
  const r = await routeHelper('hyde', core.buildHydePrompt(query), { maxTokens: 160 });
  if (!r.ok) { logger.info('rag', `HyDE fallback (provider=${r.provider}, ${r.reason})`); return { text: null, mode: 'fallback', provider: r.provider, reason: r.reason }; }
  const t = core.sanitizeHyde(r.text || '');
  return t ? { text: t, mode: 'hyde', provider: r.provider } : { text: null, mode: 'fallback', provider: r.provider, reason: 'empty' };
}

export default { rewrite, hyde };
