/**
 * localModelAid.ts — one-shot, timed call to DAWN's LOCAL model for retrieval aids (query rewrite,
 * HyDE, entailment). Local only (the bundled llama-server), never cloud. Returns an honest failure
 * ({ok:false, reason}) when the model isn't loaded, errors, or times out — callers then fall back.
 */
import runtime from '../runtime';
import * as llama from '../llama';

export interface ModelCallResult { ok: boolean; text?: string; reason?: string }

export async function callModel(prompt: string, opts: { timeoutMs?: number; maxTokens?: number; temperature?: number } = {}): Promise<ModelCallResult> {
  if (!runtime.isReady()) return { ok: false, reason: 'local model not loaded' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000);
  try {
    const text = await llama.chat(runtime.baseUrl(), [{ role: 'user', content: prompt }],
      { temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 200 }, ctrl.signal);
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'model error' };
  } finally { clearTimeout(to); }
}

export default { callModel };
