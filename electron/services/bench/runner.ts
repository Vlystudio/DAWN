/**
 * runner.ts — the shared "run one model and measure it" engine used by both Model
 * Arena (compare) and hardware benchmarking.
 *
 * DAWN runs ONE llama.cpp model at a time, so each run hot-swaps the runtime to the
 * target GGUF (capturing load time), streams a generation (capturing first-token
 * latency, total time, output), counts tokens via the server tokenizer, reads the
 * active backend / GPU layers, and detects load failures / OOM. The CALLER is
 * responsible for saving and restoring the user's original chat model.
 */
import db from '../db';
import logger from '../logger';
import settings from '../settings';
import runtime from '../runtime';
import models from '../models';
import * as llama from '../llama';
import bench from './benchCore';
import { parseModelId } from '../optimizer/modelMetadata';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunMetrics {
  ok: boolean;
  error?: string;
  oom?: boolean;
  stopped?: boolean;
  text: string;
  loadMs: number;
  firstTokenMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  tokensPerSec: number;
  backend: string;
  gpuLayers: number;
  contextLength: number;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  estRamGB: number;
  estMaxContext: number;
}

export interface RunOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  onToken?: (delta: string) => void;
  signal?: AbortSignal;
}

const OOM_RE = /out of memory|cudaMalloc|failed to allocate|ggml_backend_.*alloc|insufficient memory|vk::OutOfDeviceMemory|MEMORY|exited unexpectedly/i;

/** Wait until the runtime reports READY (model loaded) or fails. */
async function waitReady(timeoutMs: number, signal?: AbortSignal): Promise<{ ok: boolean; error?: string; oom?: boolean }> {
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) return { ok: false, error: 'cancelled' };
    const st = runtime.getStatus();
    if (st.state === 'READY' || st.state === 'GENERATING') return { ok: true };
    if (st.state === 'ERROR') return { ok: false, error: st.error || 'runtime error', oom: OOM_RE.test(st.error || '') };
    if (Date.now() - t0 > timeoutMs) return { ok: false, error: 'model did not load in time', oom: false };
    await delay(400);
  }
}

/** Hot-swap to a model, generate, and measure. Caller restores the prior model. */
export async function runModel(modelPath: string, prompt: string, opts: RunOptions = {}): Promise<RunMetrics> {
  const s = settings.get();
  const blank: RunMetrics = {
    ok: false, text: '', loadMs: 0, firstTokenMs: 0, totalMs: 0, promptTokens: 0, completionTokens: 0,
    tokensPerSec: 0, backend: 'Unknown', gpuLayers: 0, contextLength: s.contextLength || 4096,
    temperature: opts.temperature ?? s.temperature, topP: opts.topP ?? s.topP, repeatPenalty: opts.repeatPenalty ?? s.repeatPenalty,
    estRamGB: 0, estMaxContext: 0,
  };

  if (!runtime.isInstalled()) return { ...blank, error: 'llama-server runtime is not installed.' };

  // 1. load (measure)
  const tLoad = Date.now();
  try {
    await runtime.switchModel(modelPath);
  } catch (e: any) {
    return { ...blank, error: `Failed to load model: ${e.message}` };
  }
  const ready = await waitReady(120000, opts.signal);
  const loadMs = Date.now() - tLoad;
  if (!ready.ok) {
    return { ...blank, loadMs, error: ready.error, oom: ready.oom };
  }

  const baseUrl = runtime.baseUrl();
  const messages: llama.ChatMsg[] = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: prompt });
  const params: llama.SamplingParams = {
    temperature: opts.temperature ?? s.temperature,
    top_p: opts.topP ?? s.topP,
    top_k: opts.topK ?? s.topK,
    repeat_penalty: opts.repeatPenalty ?? s.repeatPenalty,
    max_tokens: opts.maxTokens ?? 512,
  };

  // 2. generate (measure first-token + total)
  const t0 = Date.now();
  let firstTokenMs = 0;
  let text = '';
  let stopped = false;
  runtime.setGenerating(true);
  try {
    text = await llama.chatStream(baseUrl, messages, params, (delta) => {
      if (!firstTokenMs) firstTokenMs = Date.now() - t0;
      opts.onToken?.(delta);
    }, opts.signal || new AbortController().signal);
  } catch (e: any) {
    if (e?.name === 'AbortError') { stopped = true; }
    else {
      const oom = OOM_RE.test(e?.message || '') || runtime.getStatus().state === 'ERROR';
      return { ...blank, loadMs, error: e?.message || 'generation failed', oom };
    }
  } finally {
    runtime.setGenerating(false);
  }
  const totalMs = Date.now() - t0;

  // 3. token counts (accurate via server; fallback to estimate)
  const promptText = (opts.systemPrompt ? opts.systemPrompt + '\n' : '') + prompt;
  const promptTokens = (await llama.tokenize(baseUrl, promptText, opts.signal)) ?? bench.estimateTokens(promptText);
  const completionTokens = (await llama.tokenize(baseUrl, text, opts.signal)) ?? bench.estimateTokens(text);

  // 4. context / backend / hardware estimates
  const st = runtime.getStatus();
  const ngl = s.lowVram || s.performanceMode === 'cpu' ? 0 : (s.gpuLayers || (s.performanceMode === 'high' ? 999 : 0));
  const fileInfo = models.list().find((m) => m.path === modelPath);
  const parsed = parseModelId(fileInfo?.name || modelPath);
  const vramGB = await bestVramGB();

  const metrics: RunMetrics = {
    ok: true,
    stopped,
    text,
    loadMs,
    firstTokenMs,
    totalMs,
    promptTokens,
    completionTokens,
    tokensPerSec: bench.tokensPerSec(completionTokens, totalMs),
    backend: st.backend || 'Unknown',
    gpuLayers: ngl,
    contextLength: s.contextLength || 4096,
    temperature: params.temperature!,
    topP: params.top_p!,
    repeatPenalty: params.repeat_penalty!,
    estRamGB: fileInfo?.estRamGB || 0,
    estMaxContext: bench.estMaxContext(parsed.paramsB, parsed.quant, vramGB, models.systemRamGB()),
  };
  logger.info('bench', `${fileInfo?.name || modelPath}: ${metrics.tokensPerSec} tok/s, load ${loadMs}ms, ${metrics.backend}`);
  return metrics;
}

/** Hardware VRAM (best GPU) for max-context math — async, cached by hardware service. */
export async function bestVramGB(): Promise<number> {
  try {
    const hw = await require('../hardware').default.detect();
    return Math.max(0, ...(hw.gpus || []).map((g: any) => g.vramGB || 0));
  } catch {
    return 0;
  }
}

export default { runModel, bestVramGB };
