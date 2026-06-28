import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app, shell } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * Model Manager — manages local GGUF files in %APPDATA%/DAWN/models.
 * Import/select/remove, with size, detected quantization, and a rough RAM estimate.
 * No automatic downloading.
 */

export interface ModelInfo {
  name: string;
  path: string;
  size: number;
  quant: string;
  estRamGB: number;
  loaded: boolean;
}

export function modelsDir(): string {
  const dir = settings.get().modelsRoot || path.join(app.getPath('userData'), 'models');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

/** Recursively collect .gguf files (models folder + family subfolders). */
function walkGguf(dir: string, depth = 0): string[] {
  let out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 2) out = out.concat(walkGguf(full, depth + 1));
    // Skip mmproj / vision-projector sidecar files — they aren't standalone models.
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf') && !/mmproj/i.test(e.name)) out.push(full);
  }
  return out;
}

/** Detect a quantization tag from the filename, e.g. Q4_K_M, Q8_0, F16. */
function detectQuant(name: string): string {
  const m = name.match(/\b(IQ\d[\w]*|Q\d(_[\w]+)*|F16|F32|BF16)\b/i);
  return m ? m[1].toUpperCase() : 'unknown';
}

/** Very rough RAM estimate: file size + ~20% overhead. */
function estRamGB(size: number): number {
  return Math.round(((size * 1.2) / 1024 ** 3) * 10) / 10;
}

export function list(): ModelInfo[] {
  const dir = modelsDir();
  const selected = settings.get().modelPath;
  return walkGguf(dir).map((full) => {
    const name = path.basename(full);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      /* ignore */
    }
    return { name, path: full, size, quant: detectQuant(name), estRamGB: estRamGB(size), loaded: full === selected };
  });
}

/** Copy an external .gguf into DAWN's models folder. Returns the new path. */
export function importModel(srcPath: string): { ok: boolean; path?: string; error?: string } {
  if (!srcPath || !srcPath.toLowerCase().endsWith('.gguf')) return { ok: false, error: 'Not a .gguf file.' };
  if (!fs.existsSync(srcPath)) return { ok: false, error: 'Source file not found.' };
  const dest = path.join(modelsDir(), path.basename(srcPath));
  try {
    if (path.resolve(srcPath) === path.resolve(dest)) return { ok: true, path: dest };
    fs.copyFileSync(srcPath, dest);
    logger.info('models', `Imported model: ${path.basename(dest)}`);
    return { ok: true, path: dest };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function select(modelPath: string) {
  settings.save({ modelPath });
  logger.info('models', `Selected model: ${path.basename(modelPath)}`);
  return settings.get();
}

export function remove(modelPath: string): boolean {
  // Only allow removing files inside the DAWN models folder.
  if (path.dirname(path.resolve(modelPath)) !== path.resolve(modelsDir())) return false;
  try {
    fs.unlinkSync(modelPath);
    if (settings.get().modelPath === modelPath) settings.save({ modelPath: '' });
    return true;
  } catch {
    return false;
  }
}

export function openFolder() {
  return shell.openPath(modelsDir());
}

/** Total system RAM in GB (for the "too large" warning). */
export function systemRamGB(): number {
  return Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
}

export default { modelsDir, list, importModel, select, remove, openFolder, systemRamGB };
