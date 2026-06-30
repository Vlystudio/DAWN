/**
 * optimizer.ts — the DAWN Model Optimizer service. Ties the pure core (metadata,
 * compatibility, settings) to real hardware detection, persistence, and DAWN's actual
 * model runtime:
 *
 *   analyze(id)            → friendly name + compatibility + recommended settings
 *   listModels()           → analysis for every installed GGUF + the hardware profile
 *   apply(id, opts)        → write optimized settings to DAWN's settings store and
 *                            (optionally) hot-swap the llama.cpp runtime to this model
 *   recommendForTask(task) → rank installed models by how well they fit a task
 *   reoptimizeNeeded(id)   → did the hardware change since this model was last tuned?
 *
 * "Apply" maps OptimizedSettings onto the exact keys runtime.buildArgs reads
 * (contextLength/threads/gpuLayers/batchSize/lowVram/performanceMode), so the
 * optimization actually changes how the model is launched. The real backend
 * identifier (the GGUF) is always preserved — friendly names are display-only.
 */
import * as path from 'path';
import * as fs from 'fs';
import settings from '../settings';
import runtime from '../runtime';
import models from '../models';
import logger from '../logger';
import { identify, parseModelId } from './modelMetadata';
import { scoreCompatibility } from './compatibilityScorer';
import { optimize } from './settingsOptimizer';
import { detectProfile, cachedProfile } from './hardwareDetectionService';
import storage from './optimizerStorage';
import {
  Compatibility, HardwareProfile, ModelAnalysis, ModelMetadata, OptimizationResult,
  OptimizedSettings, OptimizerMode,
} from './optimizerTypes';

export type Task = 'code' | 'chat' | 'reasoning' | 'research' | 'summarize' | 'rag' | 'vision' | 'cybersecurity' | 'low-resource';

export interface AnalyzeResult extends ModelAnalysis {
  savedMode?: OptimizerMode;
  manualOverride?: boolean;
  reoptimizeNeeded?: boolean;
  lastTunedAt?: string;
}

export interface ApplyOptions {
  mode?: OptimizerMode;
  load?: boolean;                          // also hot-swap the runtime to this model
  force?: boolean;                         // force-load a "Not recommended" model
  customSettings?: Partial<OptimizedSettings>; // manual override (Advanced Settings)
}

export interface ApplyResult {
  ok: boolean;
  blocked?: boolean;                       // refused (Unsupported, or Not-recommended without force)
  reason?: string;
  warnings?: string[];
  settings?: OptimizedSettings;
  optimization?: OptimizationResult;
  compatibility?: Compatibility;
  loaded?: boolean;                        // runtime switched to this model
  loadError?: string;
  manualOverride?: boolean;
}

const ALL_MODES: OptimizerMode[] = ['Performance', 'Balanced', 'Quality', 'Safe', 'Low VRAM'];

/** Resolve a model identifier to an installed .gguf path, if present. */
function resolvePath(modelId: string): string {
  if (!modelId) return '';
  if (/\.gguf$/i.test(modelId) && fs.existsSync(modelId)) return modelId;
  const base = path.basename(modelId).toLowerCase();
  const found = models.list().find((m) => m.name.toLowerCase() === base || m.path.toLowerCase() === modelId.toLowerCase());
  return found ? found.path : '';
}

function analyzeWith(modelId: string, profile: HardwareProfile, modeOverride?: OptimizerMode): AnalyzeResult {
  const parsed = parseModelId(modelId);
  const meta: ModelMetadata = identify(modelId);
  const compatibility = scoreCompatibility(meta, profile);
  const rec = storage.getRecord(modelId);
  const mode = modeOverride || rec?.mode || compatibility.recommendedMode;
  const optimization = optimize(meta, profile, mode, compatibility);
  const p = resolvePath(modelId);
  return {
    actualName: meta.actualName,
    path: p || undefined,
    parsed,
    metadata: meta,
    compatibility,
    optimization,
    installed: !!p,
    savedMode: rec?.mode,
    manualOverride: rec?.manualOverride,
    lastTunedAt: rec?.updatedAt,
    reoptimizeNeeded: !!rec && !!rec.hardwareHash && rec.hardwareHash !== profile.hash,
  };
}

/** Analyze a single model (by gguf filename, full path, or ollama-style tag). */
export async function analyze(modelId: string, mode?: OptimizerMode): Promise<AnalyzeResult> {
  const profile = await detectProfile();
  return analyzeWith(modelId, profile, mode);
}

/** All five presets for one model (for the mode picker / comparison). */
export async function previewModes(modelId: string): Promise<{ mode: OptimizerMode; optimization: OptimizationResult }[]> {
  const profile = await detectProfile();
  const meta = identify(modelId);
  const compat = scoreCompatibility(meta, profile);
  return ALL_MODES.map((mode) => ({ mode, optimization: optimize(meta, profile, mode, compat) }));
}

/** Analyze every installed GGUF, plus return the hardware profile. */
export async function listModels(): Promise<{ profile: HardwareProfile; models: AnalyzeResult[] }> {
  const profile = await detectProfile();
  const list = models.list();
  const analyses = list.map((m) => analyzeWith(m.path, profile));
  // sort: installed-and-best first
  analyses.sort((a, b) => b.compatibility.score - a.compatibility.score);
  return { profile, models: analyses };
}

/** Map OptimizedSettings onto the exact settings keys DAWN's runtime reads. */
function writeSettings(s: OptimizedSettings) {
  settings.save({
    contextLength: s.contextLength,
    threads: s.threads,
    gpuLayers: s.gpuLayers,
    batchSize: s.batchSize,
    ubatchSize: s.ubatchSize,
    mmap: s.mmap,
    mlock: s.mlock,
    temperature: s.temperature,
    topP: s.topP,
    topK: s.topK,
    repeatPenalty: s.repeatPenalty,
    maxTokens: s.maxTokens,
    lowVram: s.lowVram,
    performanceMode: s.performanceMode,
    highPerformance: s.performanceMode === 'high',
  });
}

/**
 * Generate + apply optimized settings for a model, and optionally load it.
 * Safety: a truly Unsupported model is refused; a "Not recommended" model requires
 * `force`. Both report a plain-English reason instead of silently failing.
 */
export async function apply(modelId: string, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const profile = await detectProfile();
  const meta = identify(modelId);
  const compatibility = scoreCompatibility(meta, profile);

  if (compatibility.level === 'Unsupported') {
    return { ok: false, blocked: true, reason: compatibility.reason, warnings: compatibility.warnings, compatibility };
  }
  if (compatibility.level === 'Not recommended' && !opts.force) {
    return {
      ok: false, blocked: true,
      reason: `${meta.friendlyName} is not recommended on this hardware: ${compatibility.reason} You can force-load it anyway (it may be very slow or unstable).`,
      warnings: compatibility.warnings, compatibility,
    };
  }

  const mode = opts.mode || storage.getRecord(modelId)?.mode || compatibility.recommendedMode;
  const optimization = optimize(meta, profile, mode, compatibility);
  let finalSettings: OptimizedSettings = optimization.settings;
  let manualOverride = false;
  if (opts.customSettings && Object.keys(opts.customSettings).length) {
    finalSettings = sanitizeSettings({ ...finalSettings, ...opts.customSettings }, profile);
    manualOverride = true;
  }

  writeSettings(finalSettings);
  storage.saveRecord({
    modelKey: modelId,
    friendlyName: meta.friendlyName,
    mode,
    settings: finalSettings,
    manualOverride,
    forcedLoad: compatibility.level === 'Not recommended' && !!opts.force,
    hardwareHash: profile.hash || '',
  });
  storage.setLastHardwareHash(profile.hash || '');
  logger.info('optimizer', `Applied ${mode}${manualOverride ? ' (manual override)' : ''} for ${meta.friendlyName} [${meta.actualName}]`);

  let loaded = false; let loadError: string | undefined;
  if (opts.load) {
    const p = resolvePath(modelId);
    if (!p) { loadError = 'Model file not found on disk — settings saved, but nothing was loaded.'; }
    else {
      const r = await runtime.switchModel(p);
      loaded = !!r.ok; loadError = r.error;
    }
  }

  return {
    ok: true, settings: finalSettings, optimization, compatibility,
    warnings: compatibility.warnings, loaded, loadError, manualOverride,
  };
}

/** Guardrails so a manual override can't crash the runtime. */
function sanitizeSettings(s: OptimizedSettings, profile: HardwareProfile): OptimizedSettings {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
  const threads = profile.cpuThreads || 8;
  return {
    ...s,
    contextLength: clamp(s.contextLength || 4096, 512, 131072),
    gpuLayers: s.gpuLayers === 999 ? 999 : clamp(s.gpuLayers || 0, 0, 999),
    threads: clamp(s.threads || threads, 1, Math.max(1, threads * 2)),
    batchSize: clamp(s.batchSize || 256, 16, 4096),
    ubatchSize: s.ubatchSize ? clamp(s.ubatchSize, 16, 4096) : 0,
    mmap: s.mmap !== false,
    mlock: !!s.mlock,
    maxTokens: clamp(s.maxTokens || 1024, 16, 32768),
    temperature: Math.max(0, Math.min(2, s.temperature ?? 0.7)),
    topP: Math.max(0, Math.min(1, s.topP ?? 0.9)),
    topK: clamp(s.topK ?? 40, 0, 1000),
    repeatPenalty: Math.max(0.8, Math.min(2, s.repeatPenalty ?? 1.1)),
    parallelRequests: 1,
  };
}

/** Mark/clear a model's manual-override flag (used by Advanced Settings UI). */
export function setManualOverride(modelId: string, override: boolean) {
  return storage.setManualOverride(modelId, override);
}

/** Reset a model back to DAWN's recommendation (drops the saved record). */
export async function resetToRecommended(modelId: string): Promise<ApplyResult> {
  storage.clearRecord(modelId);
  return apply(modelId, { mode: undefined });
}

export async function reoptimizeNeeded(modelId: string): Promise<boolean> {
  const profile = cachedProfile() || (await detectProfile());
  return storage.reoptimizeNeeded(modelId, profile.hash || '');
}

export async function getHardware(force = false): Promise<HardwareProfile> {
  return detectProfile(force);
}

// --- task-aware recommendations -------------------------------------------
function taskFit(meta: ModelMetadata, task: Task): { bonus: number; why: string } {
  const cat = meta.category;
  const tags = meta.tags || [];
  const has = (t: string) => tags.includes(t);
  switch (task) {
    case 'code':
      if (cat === 'Coding' || has('code')) return { bonus: 45, why: 'specialized for coding' };
      if (cat === 'Reasoning') return { bonus: 10, why: 'decent at code via reasoning' };
      if (cat === 'Embeddings') return { bonus: -80, why: 'embeddings model — not for coding' };
      return { bonus: 0, why: 'general model' };
    case 'reasoning':
      if (cat === 'Reasoning' || cat === 'Planning' || has('reasoning')) return { bonus: 45, why: 'strong step-by-step reasoning' };
      if (cat === 'Coding') return { bonus: 8, why: 'logical but code-focused' };
      if (cat === 'Embeddings') return { bonus: -80, why: 'embeddings model — not for reasoning' };
      return { bonus: 5, why: 'general reasoning' };
    case 'chat':
      if (cat === 'General Assistant') return { bonus: 35, why: 'well-rounded assistant' };
      if (cat === 'Lightweight/Fast') return { bonus: 25, why: 'fast everyday chat' };
      if (cat === 'Embeddings') return { bonus: -80, why: 'embeddings model — not for chat' };
      return { bonus: 10, why: 'usable for chat' };
    case 'research':
      if (has('long-context')) return { bonus: 40, why: 'handles long context for research' };
      if (cat === 'General Assistant' || cat === 'Reasoning') return { bonus: 28, why: 'good for research & synthesis' };
      if (cat === 'Embeddings') return { bonus: -60, why: 'embeddings model — pair with a chat model' };
      return { bonus: 8, why: 'general model' };
    case 'summarize':
      if (cat === 'Summarization') return { bonus: 40, why: 'tuned for summarization' };
      if (cat === 'General Assistant' || cat === 'Lightweight/Fast') return { bonus: 25, why: 'good, fast summarizer' };
      if (cat === 'Embeddings') return { bonus: -80, why: 'embeddings model — not for summarizing' };
      return { bonus: 8, why: 'general model' };
    case 'rag':
      if (cat === 'Embeddings' || has('embeddings')) return { bonus: 60, why: 'embeddings — exactly what RAG needs' };
      return { bonus: -40, why: 'not an embeddings model' };
    case 'vision':
      if (cat === 'Vision') return { bonus: 70, why: 'multimodal vision model' };
      return { bonus: -90, why: 'no vision capability' };
    case 'cybersecurity':
      if (cat === 'Reasoning' || cat === 'Coding') return { bonus: 35, why: 'reasoning/coding suits security analysis' };
      if (cat === 'General Assistant' && meta.paramsB >= 13) return { bonus: 22, why: 'large general model for security Q&A' };
      if (cat === 'Embeddings') return { bonus: -80, why: 'embeddings model — not for analysis' };
      return { bonus: 5, why: 'general model' };
    case 'low-resource':
      if (cat === 'Lightweight/Fast' || meta.paramsB <= 4) return { bonus: 40, why: 'tiny and fast' };
      return { bonus: Math.round((8 - Math.min(meta.paramsB, 8)) * 4), why: `${meta.paramsB}B — heavier` };
    default:
      return { bonus: 0, why: 'general model' };
  }
}

/** Fast friendly-name lookup for the UI (pure, no hardware detection). */
export function nameFor(modelId: string): { friendlyName: string; actualName: string; category: string; known: boolean } {
  const m = identify(modelId);
  return { friendlyName: m.friendlyName, actualName: m.actualName, category: m.category, known: m.known };
}

/** Batch friendly-name lookup keyed by basename (for the model dropdown, etc.). */
export function namesFor(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids || []) {
    const key = String(id || '').split(/[\\/]/).pop() || '';
    if (key) out[key] = identify(id).friendlyName;
  }
  return out;
}

/** Rank installed models for a task: compatibility score + task-fit bonus. */
export async function recommendForTask(task: Task): Promise<{ profile: HardwareProfile; ranked: (AnalyzeResult & { taskScore: number; taskWhy: string })[] }> {
  const profile = await detectProfile();
  const ranked = models.list().map((m) => {
    const a = analyzeWith(m.path, profile);
    const fit = taskFit(a.metadata, task);
    const taskScore = Math.max(0, Math.min(100, Math.round(a.compatibility.score * 0.6 + 50 + fit.bonus * 0.5)));
    return { ...a, taskScore, taskWhy: fit.why };
  });
  ranked.sort((x, y) => y.taskScore - x.taskScore);
  return { profile, ranked };
}

export default {
  analyze, previewModes, listModels, apply, resetToRecommended, setManualOverride,
  reoptimizeNeeded, getHardware, recommendForTask, nameFor, namesFor,
};
