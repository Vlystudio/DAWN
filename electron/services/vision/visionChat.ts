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
import core, { Capability, VlmPair } from './visionChatCore';

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

function isGguf(p: string): boolean { return /\.gguf$/i.test(String(p || '')); }

/** Granular setup validation for the Model Hub vision panel (basenames only, no full paths out). */
export function validate() {
  const s: any = settings.get();
  return core.validateSetup({
    vlmModelPath: s.vlmModelPath || '', vlmMmprojPath: s.vlmMmprojPath || '',
    vlmModelExists: !!(s.vlmModelPath && safeExists(s.vlmModelPath)),
    mmprojExists: !!(s.vlmMmprojPath && safeExists(s.vlmMmprojPath)),
    modelIsGguf: isGguf(s.vlmModelPath), mmprojIsGguf: isGguf(s.vlmMmprojPath),
    cliExists: !!mtmdCliPath(),
  });
}

/** Scan ONLY DAWN's model folders (depth-limited) for gguf files, INCLUDING mmproj projectors. */
function scanGgufFiles(): { name: string; dir: string; path: string; sizeBytes: number }[] {
  let modelsDir = '';
  try { modelsDir = require('../models').default.modelsDir(); } catch { return []; }
  const out: { name: string; dir: string; path: string; sizeBytes: number }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && /\.gguf$/i.test(e.name)) {
        let sizeBytes = 0; try { sizeBytes = fs.statSync(full).size; } catch { /* */ }
        out.push({ name: e.name, dir, path: full, sizeBytes });
      }
    }
  };
  if (modelsDir) walk(modelsDir, 0);
  return out;
}

/** Auto-detect likely VLM+mmproj pairs from the model folders. Returns SAFE fields only (names, not
 *  full paths). The user must confirm before anything is applied. */
export function autoDetect(): { pairs: VlmPair[]; scanned: number } {
  const files = scanGgufFiles();
  const pairs = core.detectVlmPairs(files.map((f) => ({ name: f.name, dir: f.dir, sizeBytes: f.sizeBytes })));
  return { pairs, scanned: files.length };
}

/** Apply an auto-detected pair BY NAME (re-resolved against a fresh scan → no full path crosses IPC).
 *  Validates, then saves. Requires the exact names from a prior autoDetect() candidate. */
export function applyPair(modelName: string, mmprojName: string) {
  const files = scanGgufFiles();
  const model = files.find((f) => f.name === modelName && !/mmproj/i.test(f.name));
  const mmproj = files.find((f) => f.name === mmprojName && /mmproj/i.test(f.name));
  if (!model || !mmproj) return { ok: false, error: 'Could not resolve that pair in your model folder (re-scan and try again).' };
  settings.save({ vlmModelPath: model.path, vlmMmprojPath: mmproj.path });
  return { ok: true, validation: validate() };
}

/** Set one path from a picked file (path stays in main; only a basename + validation returns). */
export function setModelPath(kind: 'model' | 'mmproj', filePath: string) {
  if (!filePath || !safeExists(filePath)) return { ok: false, error: 'File not found.' };
  if (!isGguf(filePath)) return { ok: false, error: 'That is not a .gguf file.' };
  settings.save(kind === 'model' ? { vlmModelPath: filePath } : { vlmMmprojPath: filePath });
  return { ok: true, name: path.basename(filePath), validation: validate() };
}

export function clearSetup() { settings.save({ vlmModelPath: '', vlmMmprojPath: '' }); return { ok: true, validation: validate() }; }

// A tiny, valid 8x8 PNG (solid) generated once — used to actually exercise the CLI in "Test Vision".
function testImagePath(): string {
  const dir = path.join(app.getPath('userData'), 'chat-attachments');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* */ }
  const p = path.join(dir, '_vision_selftest.png');
  if (!safeExists(p)) {
    // 1x1 transparent PNG (smallest valid) — enough to prove the pipeline end-to-end.
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    try { fs.writeFileSync(p, Buffer.from(b64, 'base64')); } catch { /* */ }
  }
  return p;
}

/** User-triggered real verification: run the actual vision path on a tiny test image (or a provided
 *  one) and return a sanitized status. Never fabricates — a missing model/CLI/timeout is honest. */
export async function testModel(imagePath?: string): Promise<{ ok: boolean; state: string; text?: string; error?: string; model?: string }> {
  const cap = capabilities();
  if (!cap.ready || cap.mode !== 'vlm') return { ok: false, state: cap.status, error: cap.reason };
  const img = imagePath && safeExists(imagePath) ? imagePath : testImagePath();
  const res = await analyzeImage(img, 'Briefly describe this image. If it is blank, say so.');
  if (res.ok && res.text) return { ok: true, state: 'success', text: String(res.text).slice(0, 400), model: res.model };
  return { ok: false, state: 'failed', error: res.error };
}

export default { mtmdCliPath, capabilities, analyzeImage, validate, autoDetect, applyPair, setModelPath, clearSetup, testModel };
