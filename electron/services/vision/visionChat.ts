/**
 * visionChat.ts — Electron service that gives CHAT the ability to actually understand an attached
 * image, honestly. It detects whether a real vision path exists (a VLM GGUF + its mmproj + the bundled
 * `llama-mtmd-cli.exe`) and, when it does, runs that CLI on the stored image to get a real description.
 * When no vision model is configured it returns an honest "unavailable/needs setup" result — it never
 * fabricates image contents. All capability/argument/output logic is the pure visionChatCore.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { app } from 'electron';
import settings from '../settings';
import logger from '../logger';
import core, { Capability } from './visionChatCore';

/** Locate the bundled multimodal CLI (same search order runtime.ts uses for llama-server). */
export function mtmdCliPath(): string {
  const names = ['llama-mtmd-cli.exe', 'llama-mtmd-cli'];
  const dirs = [
    path.join(process.resourcesPath || '', 'runtime'),
    path.join(app.getAppPath(), 'resources', 'runtime'),
    path.join(app.getAppPath(), '..', 'resources', 'runtime'),
    path.join(process.cwd(), 'resources', 'runtime'),
  ];
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try { if (p && fs.existsSync(p)) return p; } catch { /* */ }
  }
  return '';
}

/** Honest capability report — derived only from real files on disk. */
export function capabilities(): Capability & { cliPath: string } {
  const s: any = settings.get();
  const cliPath = mtmdCliPath();
  const cap = core.resolveCapability({
    vlmModelPath: s.vlmModelPath || '',
    vlmMmprojPath: s.vlmMmprojPath || '',
    vlmModelExists: !!(s.vlmModelPath && safeExists(s.vlmModelPath)),
    mmprojExists: !!(s.vlmMmprojPath && safeExists(s.vlmMmprojPath)),
    cliExists: !!cliPath,
    ocrAvailable: false, // OCR-on-arbitrary-image fallback is not wired yet (the Live Vision OCR is camera-frame only) — reported honestly
  });
  return { ...cap, cliPath };
}

function safeExists(p: string): boolean { try { return fs.existsSync(p); } catch { return false; } }

export interface AnalyzeResult {
  ok: boolean; mode: 'vlm' | 'ocr' | 'none';
  text?: string; error?: string; model?: string;
}

/**
 * Analyze ONE image with the local vision model. Returns the model's real (untrusted) description, or
 * an honest failure. `imagePath` is an internal main-process path (never from the renderer). Heavily
 * guarded: a missing model, a spawn error, or a timeout all resolve to ok:false — never a fake answer.
 */
export function analyzeImage(imagePath: string, prompt: string): Promise<AnalyzeResult> {
  const cap = capabilities();
  if (!cap.ready || cap.mode !== 'vlm') {
    return Promise.resolve({ ok: false, mode: cap.mode, error: cap.reason });
  }
  const s: any = settings.get();
  if (!imagePath || !safeExists(imagePath)) return Promise.resolve({ ok: false, mode: 'vlm', error: 'The stored image could not be read.' });
  const args = core.buildMtmdArgs({
    modelPath: s.vlmModelPath, mmprojPath: s.vlmMmprojPath, imagePath,
    prompt, nGpuLayers: typeof s.gpuLayers === 'number' ? s.gpuLayers : 99, maxTokens: 300, temperature: 0.2,
  });
  const modelName = path.basename(String(s.vlmModelPath));
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: AnalyzeResult) => { if (!done) { done = true; resolve(r); } };
    try {
      const child = execFile(cap.cliPath, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !stdout) {
          logger.warn('visionChat', `mtmd-cli failed: ${String(err.message || err).slice(0, 200)}`);
          return finish({ ok: false, mode: 'vlm', error: 'The local vision model failed to analyze the image.' });
        }
        const text = core.sanitizeCliOutput(String(stdout || ''), prompt);
        if (!text) return finish({ ok: false, mode: 'vlm', error: 'The vision model returned no readable description.' });
        finish({ ok: true, mode: 'vlm', text, model: modelName });
      });
      child.on('error', () => finish({ ok: false, mode: 'vlm', error: 'Could not start the local vision model.' }));
    } catch (e: any) {
      finish({ ok: false, mode: 'vlm', error: 'Could not start the local vision model.' });
    }
  });
}

export default { mtmdCliPath, capabilities, analyzeImage };
