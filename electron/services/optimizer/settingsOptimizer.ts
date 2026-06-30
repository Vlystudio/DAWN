/**
 * settingsOptimizer.ts — pure: turn (model metadata + hardware + mode) into concrete
 * OptimizedSettings that map cleanly onto DAWN's llama.cpp runtime args, plus a
 * human-readable explanation, the list of changed settings, tradeoffs, and any
 * recommended-but-unsupported notes.
 *
 * Runtime mapping (electron/services/runtime.ts buildArgs):
 *   -c contextLength · -t threads · -b batchSize ·
 *   -ngl = (lowVram || performanceMode==='cpu') ? 0 : (gpuLayers || (performanceMode==='high'?999:0))
 * So we ALWAYS set an explicit gpuLayers number (999 = all). lowVram/cpu are only used
 * when we genuinely want zero GPU layers — that keeps -ngl predictable.
 */
import { Compatibility, HardwareProfile, ModelMetadata, OptimizationResult, OptimizedSettings, OptimizerMode } from './optimizerTypes';
import { bytesPerParamGB, kvCacheGB } from './modelMetadata';

function round1(n: number): number { return Math.round(n * 10) / 10; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function nf(n: number): string { return n.toLocaleString('en-US'); }

function bestVram(hw: HardwareProfile): number {
  if (!hw.gpus || !hw.gpus.length) return 0;
  return Math.max(0, ...hw.gpus.map((g) => g.vramGB || 0));
}
function gpuUsable(hw: HardwareProfile): boolean {
  const vram = bestVram(hw);
  if (vram <= 0) return false;
  if (hw.backends?.cpuOnly && !(hw.backends?.cuda || hw.backends?.directML || hw.backends?.metal || hw.backends?.rocm)) return false;
  return true;
}
function physicalCores(hw: HardwareProfile): number {
  return hw.cpuCores || (hw.cpuThreads ? Math.max(2, Math.round(hw.cpuThreads / 2)) : 4);
}

/** Rough transformer block count by size (for layer-offload math). */
function estimateLayers(paramsB: number): number {
  if (paramsB <= 0) return 32;
  if (paramsB <= 1.5) return 22;
  if (paramsB <= 3) return 26;
  if (paramsB <= 4) return 32;
  if (paramsB <= 9) return 32;
  if (paramsB <= 16) return 40;
  if (paramsB <= 35) return 64;
  if (paramsB <= 50) return 32;   // MoE (e.g. Mixtral) — fewer, fatter blocks
  return 80;
}

interface ModeKnobs { ctxCap: number; ctxMul: number; batch: number; headroomGB: number; maxTokMul: number; }
function knobsFor(mode: OptimizerMode): ModeKnobs {
  switch (mode) {
    case 'Performance': return { ctxCap: 8192, ctxMul: 1.0, batch: 512, headroomGB: 1.0, maxTokMul: 1.0 };
    case 'Quality':     return { ctxCap: 16384, ctxMul: 2.0, batch: 512, headroomGB: 1.6, maxTokMul: 1.5 };
    case 'Safe':        return { ctxCap: 4096, ctxMul: 1.0, batch: 256, headroomGB: 2.5, maxTokMul: 1.0 };
    case 'Low VRAM':    return { ctxCap: 2048, ctxMul: 1.0, batch: 128, headroomGB: 1.4, maxTokMul: 0.75 };
    case 'Balanced':
    default:            return { ctxCap: 8192, ctxMul: 1.0, batch: 512, headroomGB: 1.2, maxTokMul: 1.0 };
  }
}

function samplingFor(meta: ModelMetadata): { temperature: number; topP: number; topK: number; repeatPenalty: number; maxTokens: number } {
  switch (meta.category) {
    case 'Coding': return { temperature: 0.2, topP: 0.9, topK: 40, repeatPenalty: 1.05, maxTokens: 2048 };
    case 'Reasoning': case 'Planning': return { temperature: 0.3, topP: 0.95, topK: 40, repeatPenalty: 1.05, maxTokens: 3072 };
    case 'Creative Writing': return { temperature: 0.9, topP: 0.95, topK: 60, repeatPenalty: 1.1, maxTokens: 1536 };
    case 'Summarization': return { temperature: 0.4, topP: 0.9, topK: 40, repeatPenalty: 1.1, maxTokens: 768 };
    case 'Embeddings': return { temperature: 0.0, topP: 1.0, topK: 0, repeatPenalty: 1.0, maxTokens: 0 };
    default: return { temperature: 0.7, topP: 0.9, topK: 40, repeatPenalty: 1.1, maxTokens: 1024 };
  }
}

export function optimize(meta: ModelMetadata, hw: HardwareProfile, mode: OptimizerMode, compat?: Compatibility): OptimizationResult {
  const usableGpu = gpuUsable(hw);
  const vram = bestVram(hw);
  const cores = physicalCores(hw);
  const k = knobsFor(mode);
  const bpp = bytesPerParamGB(meta.quant);
  const weightsGB = Math.max(0.2, meta.paramsB * bpp);
  const totalLayers = estimateLayers(meta.paramsB);

  // context (clamped to the mode's cap and the model's recommendation)
  let contextLength = clamp(Math.round(meta.recommendedContext * k.ctxMul), 1024, k.ctxCap);
  if (meta.category === 'Embeddings') contextLength = Math.min(contextLength, 2048);

  const kv = kvCacheGB(contextLength, meta.paramsB);

  // GPU layer fit
  let gpuLayers = 0;
  let fullGpu = false;
  let performanceMode: OptimizedSettings['performanceMode'] = 'balanced';
  let lowVram = false;

  if (!usableGpu) {
    gpuLayers = 0; performanceMode = 'cpu'; lowVram = true;
  } else {
    const perLayer = weightsGB / totalLayers;
    const budget = vram - kv - k.headroomGB;
    const fit = budget > 0 ? Math.floor(budget / perLayer) : 0;
    if (fit >= totalLayers) { gpuLayers = 999; fullGpu = true; performanceMode = mode === 'Performance' ? 'high' : 'balanced'; }
    else { gpuLayers = clamp(fit, 0, totalLayers); performanceMode = 'balanced'; }
  }

  // threads
  const threads = fullGpu ? clamp(Math.min(8, cores), 2, 16) : clamp(cores, 2, 32);

  const s = samplingFor(meta);
  const maxTokens = Math.round(s.maxTokens * k.maxTokMul);
  const batchSize = usableGpu ? k.batch : Math.min(k.batch, 256);
  // ubatch (physical batch): half the logical batch, capped — smaller on tight VRAM.
  const ubatchSize = mode === 'Low VRAM' ? Math.min(128, batchSize) : Math.min(512, Math.max(128, Math.floor(batchSize / 2)));
  // mmap on by default; mlock only when fully on GPU/CPU with comfortable RAM (avoids paging stalls).
  const totalRamGB = hw.totalRamGB || 0;
  const mmap = true;
  const mlock = !usableGpu ? totalRamGB >= weightsGB + 6 : (fullGpu && totalRamGB >= 24);

  const settings: OptimizedSettings = {
    contextLength,
    gpuLayers,
    threads,
    batchSize,
    ubatchSize,
    mmap,
    mlock,
    maxTokens,
    temperature: s.temperature,
    topP: s.topP,
    topK: s.topK,
    repeatPenalty: s.repeatPenalty,
    lowVram,
    performanceMode,
    parallelRequests: 1,
  };

  // --- narrative ----------------------------------------------------------
  const where = !usableGpu ? 'entirely on the CPU'
    : fullGpu ? 'entirely on the GPU'
    : gpuLayers > 0 ? `with ${gpuLayers} of ~${totalLayers} layers on the GPU and the rest on the CPU`
    : 'mostly on the CPU (GPU too small for any full layer)';

  const speed = compat?.expectedSpeed ? `, expected speed: ${compat.expectedSpeed}` : '';
  const explanation =
    `${mode} preset for ${meta.friendlyName} (${meta.actualName}). DAWN will run it ${where} at a ` +
    `${nf(contextLength)}-token context${speed}. ` +
    modeRationale(mode);

  const changed: string[] = [
    `Context length → ${nf(contextLength)} tokens`,
    `GPU layers → ${gpuLayers === 999 ? 'all (full GPU offload)' : gpuLayers === 0 ? 'none (CPU only)' : `${gpuLayers} of ~${totalLayers} on GPU`}`,
    `CPU threads → ${threads}`,
    `Batch / ubatch → ${settings.batchSize} / ${settings.ubatchSize}`,
    `Memory → mmap ${mmap ? 'on' : 'off'}${mlock ? ', mlock on' : ''}`,
  ];
  if (meta.category !== 'Embeddings') {
    changed.push(`Sampling → temperature ${s.temperature.toFixed(2)}, top-p ${s.topP.toFixed(2)}, top-k ${s.topK}`);
    changed.push(`Max output → ${nf(maxTokens)} tokens`);
  }

  const tradeoffs = tradeoffsFor(mode, { fullGpu, usableGpu, partial: gpuLayers > 0 && gpuLayers !== 999 });

  const unsupported: string[] = [];
  if (settings.parallelRequests <= 1) {
    // nothing to note
  }
  if ((mode === 'Low VRAM' || mode === 'Quality') && usableGpu) {
    unsupported.push('Flash-attention and KV-cache quantization would help here, but DAWN\'s bundled llama.cpp args don\'t expose them yet — skipped (no effect on stability).');
  }
  if (!usableGpu && meta.recommendedBackend === 'gpu') {
    unsupported.push('This model prefers a GPU, but none is available — DAWN is running it on the CPU instead.');
  }

  return { mode, settings, explanation, changed, tradeoffs, unsupported };
}

function modeRationale(mode: OptimizerMode): string {
  switch (mode) {
    case 'Performance': return 'Tuned for the fastest responses your hardware can sustain.';
    case 'Quality': return 'Tuned for the best answers — a larger context and longer replies, at some cost to speed and memory.';
    case 'Safe': return 'Tuned for maximum stability with conservative memory use.';
    case 'Low VRAM': return 'Tuned to fit in as little VRAM as possible so the model loads on tight hardware.';
    case 'Balanced':
    default: return 'A balance of speed, quality, and stability — DAWN\'s default.';
  }
}

function tradeoffsFor(mode: OptimizerMode, ctx: { fullGpu: boolean; usableGpu: boolean; partial: boolean }): string[] {
  const t: string[] = [];
  switch (mode) {
    case 'Performance': t.push('Prioritizes speed; uses more VRAM and leaves a smaller safety margin.'); break;
    case 'Quality': t.push('Larger context and longer answers; slower and uses more memory.'); break;
    case 'Safe': t.push('Maximum stability and a smaller memory footprint; slower with a shorter context.'); break;
    case 'Low VRAM': t.push('Smallest VRAM footprint; noticeably slower with a short context.'); break;
    case 'Balanced': default: t.push('Sensible defaults — good speed and quality without pushing memory limits.'); break;
  }
  if (ctx.partial) t.push('Some layers run on the CPU, so generation is slower than a fully-GPU model.');
  if (!ctx.usableGpu) t.push('No GPU is being used, so responses will be slow for larger models.');
  return t;
}

export default { optimize };
