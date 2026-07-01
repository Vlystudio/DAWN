/**
 * queryExpansion.ts — LOCAL query rewrite + HyDE expansion (electron). Off by default; when enabled it
 * calls the local model (via localModelAid, with a timeout) to widen retrieval, and ALWAYS falls back
 * to the original query on any failure. Rewrites/HyDE are retrieval aids only — never evidence, never
 * cited, never obeyed. Raw model output is not logged (only the mode/reason).
 */
import settings from '../settings';
import logger from '../logger';
import core from './queryExpansionCore';
import aid from './localModelAid';

export interface RewriteResult { queries: string[]; variants: string[]; keywords: string[]; mode: 'rewritten' | 'disabled' | 'fallback'; reason?: string }

export async function rewrite(query: string): Promise<RewriteResult> {
  const s: any = settings.get();
  const base = { queries: [query], variants: [] as string[], keywords: [] as string[] };
  if (!s.queryRewriteEnabled) return { ...base, mode: 'disabled' };
  const r = await aid.callModel(core.buildRewritePrompt(query, s.maxRewriteQueries || 2), { timeoutMs: s.rewriteTimeoutMs || 8000, maxTokens: 120 });
  if (!r.ok) { logger.info('rag', `query rewrite fallback (${r.reason})`); return { ...base, mode: 'fallback', reason: r.reason }; }
  const parsed = core.parseRewrite(r.text || '', query, s.maxRewriteQueries || 2);
  if (!parsed.variants.length) return { ...base, mode: 'fallback', reason: 'no usable variants' };
  return { queries: [query, ...parsed.variants], variants: parsed.variants, keywords: parsed.keywords, mode: 'rewritten' };
}

export interface HydeResult { text: string | null; mode: 'hyde' | 'disabled' | 'fallback'; reason?: string }

export async function hyde(query: string): Promise<HydeResult> {
  const s: any = settings.get();
  if (!s.hydeEnabled) return { text: null, mode: 'disabled' };
  const r = await aid.callModel(core.buildHydePrompt(query), { timeoutMs: s.rewriteTimeoutMs || 8000, maxTokens: 160 });
  if (!r.ok) { logger.info('rag', `HyDE fallback (${r.reason})`); return { text: null, mode: 'fallback', reason: r.reason }; }
  const t = core.sanitizeHyde(r.text || '');
  return t ? { text: t, mode: 'hyde' } : { text: null, mode: 'fallback', reason: 'empty' };
}

export default { rewrite, hyde };
