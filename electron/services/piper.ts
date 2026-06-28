import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * piper.ts — high-quality LOCAL neural TTS via Piper (resources/piper).
 *
 * Synthesizes a sentence to a WAV (fast: ~18x real-time on CPU) and returns the
 * bytes to the renderer, which plays them. Cached by hash(model + rate + text).
 * Fully offline — no cloud. This is the "human / Jarvis-esque" voice; the Web
 * Speech engine remains a fallback.
 */

function piperDir(): string {
  const dirs = [
    path.join(process.resourcesPath || '', 'piper'),
    path.join(app.getAppPath(), 'resources', 'piper'),
    path.join(app.getAppPath(), '..', 'resources', 'piper'),
    path.join(process.cwd(), 'resources', 'piper'),
  ];
  for (const d of dirs) if (d && fs.existsSync(path.join(d, 'piper.exe'))) return d;
  return '';
}
function exePath() {
  const d = piperDir();
  return d ? path.join(d, 'piper.exe') : '';
}
function voicesDir() {
  const d = piperDir();
  return d ? path.join(d, 'voices') : '';
}

export function voices(): { name: string; path: string }[] {
  const d = voicesDir();
  if (!d || !fs.existsSync(d)) return [];
  try {
    return fs.readdirSync(d).filter((f) => f.endsWith('.onnx')).map((f) => ({ name: f.replace('.onnx', ''), path: path.join(d, f) }));
  } catch {
    return [];
  }
}

export function available(): boolean {
  return !!exePath() && voices().length > 0;
}

/** Resolve the active voice model: user choice, else a British male, else first. */
function activeVoice(): string {
  const v = voices();
  const sel = settings.get().voiceModel;
  if (sel) {
    const m = v.find((x) => x.path === sel || x.name === sel);
    if (m) return m.path;
  }
  const alan = v.find((x) => /alan|en_gb.*male|english_male/i.test(x.name));
  return (alan || v[0])?.path || '';
}

function cacheDir() {
  const d = path.join(app.getPath('userData'), 'voice-cache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Synthesize text -> WAV Buffer (or null on failure / unavailable). */
export function synthesize(text: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const exe = exePath();
    const model = activeVoice();
    if (!exe || !model || !text.trim()) {
      resolve(null);
      return;
    }
    const rate = settings.get().voiceRate || 1;
    const key = crypto.createHash('sha1').update(`${model}|${rate}|${text}`).digest('hex');
    const out = path.join(cacheDir(), key + '.wav');
    if (fs.existsSync(out)) {
      try {
        resolve(fs.readFileSync(out));
        return;
      } catch {
        /* re-synthesize */
      }
    }
    // length_scale: >1 slower, <1 faster. rate>1 (faster) -> smaller length_scale.
    const lengthScale = Math.max(0.5, Math.min(2, 1 / rate));
    const args = ['-m', model, '-f', out, '--length_scale', lengthScale.toFixed(2)];
    let done = false;
    const finish = (buf: Buffer | null) => {
      if (done) return;
      done = true;
      resolve(buf);
    };
    try {
      const p = spawn(exe, args, { cwd: piperDir(), windowsHide: true });
      p.on('error', (e) => {
        logger.error('voice', `piper error: ${e.message}`);
        finish(null);
      });
      p.on('close', (code) => {
        if (code === 0 && fs.existsSync(out)) {
          try {
            finish(fs.readFileSync(out));
            return;
          } catch {
            /* */
          }
        }
        finish(null);
      });
      p.stdin.write(text);
      p.stdin.end();
      setTimeout(() => finish(null), 20000);
    } catch (e: any) {
      logger.error('voice', `piper spawn failed: ${e.message}`);
      finish(null);
    }
  });
}

export default { available, voices, synthesize };
