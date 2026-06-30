/**
 * compatibilityScorer.ts — pure scoring of a model against a HardwareProfile.
 * Produces a CompatLevel, a 0..100 score, a plain-English reason, warnings, a
 * recommended optimizer mode, expected speed, and override permission. No electron.
 *
 * Memory model (GGUF / llama.cpp):
 *   weightsGB   = paramsB * bytesPerParam(quant)
 *   kvCacheGB   = ~0.06 GB / 1K tokens for a 7B, scaled by size
 *   need        = weights + kv + runtime overhead
 * GPU fit decides Excellent/Good; small overflow → Borderline (partial offload);
 * large overflow that still fits RAM → CPU-only fallback; nothing fits → Unsupported.
 */
import { Compatibility, CompatLevel, HardwareProfile, ModelMetadata, OptimizerMode } from './optimizerTypes';
import { bytesPerParamGB, kvCacheGB } from './modelMetadata';

type Speed = Compatibility['expectedSpeed'];

function round1(n: number): number { return Math.round(n * 10) / 10; }
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }
function gb(n: number): string { return `${round1(n)} GB`; }

function bestVram(hw: HardwareProfile): number {
  if (!hw.gpus || !hw.gpus.length) return 0;
  return Math.max(0, ...hw.gpus.map((g) => g.vramGB || 0));
}
function totalRam(hw: HardwareProfile): number { return hw.totalRamGB ?? hw.availableRamGB ?? 0; }
function availRam(hw: HardwareProfile): number {
  return hw.availableRamGB ?? (hw.totalRamGB ? round1(hw.totalRamGB * 0.85) : 0);
}
function gpuUsable(hw: HardwareProfile): boolean {
  const vram = bestVram(hw);
  if (vram <= 0) return false;
  if (hw.backends?.cpuOnly && !(hw.backends?.cuda || hw.backends?.directML || hw.backends?.metal || hw.backends?.rocm)) {
    // a GPU exists but no GPU backend is available → treat as CPU
    return false;
  }
  return true;
}

export function scoreCompatibility(meta: ModelMetadata, hw: HardwareProfile): Compatibility {
  const vram = bestVram(hw);
  const ram = totalRam(hw);
  const aram = availRam(hw);
  const usableGpu = gpuUsable(hw);

  const bpp = bytesPerParamGB(meta.quant);
  const weightsGB = Math.max(0.2, meta.paramsB * bpp);
  const ctx = meta.recommendedContext;
  const kvRec = kvCacheGB(ctx, meta.paramsB);
  const kvMin = kvCacheGB(Math.min(4096, ctx), meta.paramsB);
  const vramComfort = round1(weightsGB + kvRec + 1.2);
  const vramMin = round1(weightsGB + kvMin + 0.7);
  const ramFull = round1(weightsGB + kvRec + 1.5);

  const warnings: string[] = [];
  if (!meta.known) warnings.push('DAWN does not have full metadata for this model yet. Compatibility is estimated from the model name and available hardware.');
  if (meta.paramsB === 0 && meta.category !== 'Embeddings') warnings.push('Model size could not be read from the name, so these estimates are rough.');

  let level: CompatLevel, score: number, speed: Speed, reason: string, mode: OptimizerMode;
  let fitsFullyOnGpu = false, needsCpuOffload = false, allowOverride = true;
  let estVramUseGB = 0, estRamUseGB = 0;

  if (usableGpu) {
    if (vramComfort <= vram * 0.82) {
      level = 'Excellent';
      fitsFullyOnGpu = true;
      const head = vram - vramComfort;
      score = clamp(Math.round(88 + Math.min(12, head)), 88, 100);
      speed = meta.paramsB >= 30 ? 'fast' : 'very fast';
      mode = vramComfort <= vram * 0.5 ? 'Performance' : 'Balanced';
      reason = `Fits comfortably in ${gb(vram)} of VRAM (about ${gb(vramComfort)} needed at ${ctx.toLocaleString()} context) and runs entirely on the GPU.`;
      estVramUseGB = vramComfort; estRamUseGB = 1;
    } else if (vramMin <= vram) {
      level = 'Good';
      fitsFullyOnGpu = true;
      score = clamp(Math.round(74 + (vram - vramMin) * 2), 70, 86);
      speed = meta.paramsB >= 30 ? 'moderate' : 'fast';
      mode = 'Balanced';
      reason = `Fits on the GPU but with limited headroom (about ${gb(vramMin)} of ${gb(vram)}). Best at a moderate context; very large contexts may not fit.`;
      warnings.push('Limited VRAM headroom — keep context at or below the recommended size.');
      estVramUseGB = Math.min(vram, vramComfort); estRamUseGB = 1;
    } else if (weightsGB <= vram * 1.4 && ramFull <= aram + vram) {
      level = 'Borderline';
      needsCpuOffload = true;
      score = clamp(Math.round(58 + (vram * 1.4 - weightsGB) * 3), 50, 68);
      speed = 'moderate';
      mode = 'Balanced';
      reason = `Too large to fit fully in ${gb(vram)} of VRAM (weights are about ${gb(weightsGB)}). DAWN keeps as many layers on the GPU as fit and offloads the rest to CPU/RAM — usable, but slower than a fully-GPU model.`;
      warnings.push('Partial CPU offload — expect slower generation than a model that fits entirely in VRAM.');
      estVramUseGB = vram; estRamUseGB = round1(Math.max(0, weightsGB - vram) + 2);
    } else if (ramFull <= aram) {
      level = 'CPU-only fallback';
      needsCpuOffload = true;
      score = clamp(Math.round(40 + (aram - ramFull) * 0.5), 35, 52);
      speed = meta.paramsB >= 60 ? 'very slow' : 'slow';
      mode = 'Safe';
      reason = `Far exceeds ${gb(vram)} of VRAM (weights about ${gb(weightsGB)}). It can still run mostly on the CPU using system RAM, but generation will be slow.`;
      warnings.push('Runs mostly on the CPU — expect slow responses.');
      estVramUseGB = round1(vram * 0.6); estRamUseGB = ramFull;
    } else {
      level = 'Unsupported';
      allowOverride = false; needsCpuOffload = true;
      score = 10; speed = 'very slow'; mode = 'Safe';
      reason = `Needs roughly ${gb(ramFull)} of memory, but only ${gb(vram)} VRAM + ${gb(aram)} available RAM are present. This model can't be loaded safely on this machine.`;
      warnings.push('Not enough total memory to load this model.');
      estVramUseGB = vram; estRamUseGB = aram;
    }
  } else {
    // CPU-only machine (no usable GPU backend)
    needsCpuOffload = true;
    if (ramFull > ram) {
      level = 'Unsupported';
      allowOverride = false;
      score = 8; speed = 'very slow'; mode = 'Safe';
      reason = `Needs about ${gb(ramFull)} of RAM but only ${gb(ram)} is installed. This model can't be loaded on this machine.`;
      warnings.push('Not enough RAM to load this model.');
      estRamUseGB = ram;
    } else if (meta.category === 'Embeddings' || meta.paramsB <= 3) {
      const veryTiny = meta.paramsB <= 1.5 || (meta.category === 'Embeddings' && meta.paramsB === 0);
      level = veryTiny ? 'Good' : (ramFull <= aram * 0.6 ? 'Good' : 'Borderline');
      score = veryTiny ? 78 : 66;
      speed = veryTiny ? 'fast' : 'moderate';
      mode = 'Balanced';
      reason = `Small enough to run on the CPU within ${gb(ram)} of RAM. No GPU was detected, but a model this size runs fine on CPU.`;
      estRamUseGB = ramFull;
    } else if (meta.paramsB <= 8) {
      level = 'Borderline';
      score = 48; speed = 'slow'; mode = 'Safe';
      reason = `Runs on the CPU (no GPU detected) and fits in ${gb(ram)} of RAM, but a ${meta.paramsB}B model on CPU will be noticeably slow.`;
      warnings.push('CPU-only inference for a mid-size model — expect slow responses.');
      estRamUseGB = ramFull;
    } else {
      level = 'Not recommended';
      score = 26; speed = 'very slow'; mode = 'Safe';
      reason = `A ${meta.paramsB}B model with no GPU will be extremely slow on the CPU, even though it fits in ${gb(ram)} of RAM.`;
      warnings.push('Large model with no GPU — responses may take minutes.');
      estRamUseGB = ramFull;
    }
  }

  return {
    level, score,
    reason: reason!,
    warnings,
    recommendedMode: mode!,
    expectedSpeed: speed!,
    fitsFullyOnGpu,
    needsCpuOffload,
    allowOverride,
    estVramUseGB: round1(estVramUseGB),
    estRamUseGB: round1(estRamUseGB),
  };
}

export default { scoreCompatibility };
