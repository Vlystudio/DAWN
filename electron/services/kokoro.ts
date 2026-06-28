import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as crypto from 'crypto';
import { app } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * kokoro.ts — high-quality LOCAL neural TTS via Kokoro (resources/kokoro).
 *
 * Manages a persistent Python TTS server (loads the ONNX model once for low
 * latency), started lazily on first voice use. Synthesizes a WAV per sentence
 * over 127.0.0.1, cached by hash(voice+speed+text). Fully offline. This is the
 * most human voice option; Piper / Web Speech remain fallbacks.
 */

const DEFAULT_VOICE = 'bm_george'; // calm British male
const CURATED_VOICES = ['bm_george', 'bm_fable', 'bm_lewis', 'bm_daniel', 'bf_emma', 'bf_isabella', 'bf_alice', 'bf_lily', 'am_michael', 'af_heart'];

function kokoroDir(): string {
  const dirs = [
    path.join(process.resourcesPath || '', 'kokoro'),
    path.join(app.getAppPath(), 'resources', 'kokoro'),
    path.join(app.getAppPath(), '..', 'resources', 'kokoro'),
    path.join(process.cwd(), 'resources', 'kokoro'),
  ];
  for (const d of dirs) if (d && fs.existsSync(path.join(d, 'server.py'))) return d;
  return '';
}
function pyExe() {
  const d = kokoroDir();
  return d ? path.join(d, 'venv', 'Scripts', 'python.exe') : '';
}
function modelPath() {
  return path.join(kokoroDir(), 'kokoro-v1.0.onnx');
}
function voicesPath() {
  return path.join(kokoroDir(), 'voices-v1.0.bin');
}

export function available(): boolean {
  const d = kokoroDir();
  return !!d && fs.existsSync(pyExe()) && fs.existsSync(modelPath()) && fs.existsSync(voicesPath());
}

export function voices(): string[] {
  return cachedVoices.length ? cachedVoices : CURATED_VOICES;
}

function cacheDir() {
  const d = path.join(app.getPath('userData'), 'voice-cache');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function findFreePort(start: number): Promise<number> {
  const test = (p: number) =>
    new Promise<boolean>((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
  return (async () => {
    for (let p = start; p < start + 40; p++) if (await test(p)) return p;
    return start;
  })();
}

let proc: ChildProcess | null = null;
let port = 0;
let ready = false;
let startPromise: Promise<boolean> | null = null;
let cachedVoices: string[] = [];

/** Start the Kokoro server (once) and wait until it's healthy. */
async function ensure(): Promise<boolean> {
  if (ready) return true;
  if (!available()) return false;
  if (startPromise) return startPromise;
  startPromise = (async () => {
    port = await findFreePort(8137);
    logger.step('voice', `Starting Kokoro TTS server on 127.0.0.1:${port}…`);
    proc = spawn(pyExe(), [path.join(kokoroDir(), 'server.py'), '--port', String(port), '--model', modelPath(), '--voices', voicesPath()], {
      cwd: kokoroDir(),
      windowsHide: true,
    });
    proc.stderr?.on('data', (d) => {
      const s = String(d).trim();
      if (s && !/KOKORO_READY/.test(s)) logger.info('voice', `kokoro: ${s.slice(0, 200)}`);
    });
    proc.on('exit', () => {
      ready = false;
      proc = null;
      startPromise = null;
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (!proc) break;
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          ready = true;
          try {
            const vr = await fetch(`http://127.0.0.1:${port}/voices`, { signal: AbortSignal.timeout(3000) });
            cachedVoices = await vr.json();
          } catch {
            /* keep curated */
          }
          logger.info('voice', 'Kokoro TTS ready.');
          return true;
        }
      } catch {
        /* not up yet */
      }
      await sleep(1000);
    }
    logger.error('voice', 'Kokoro server did not become healthy.');
    return false;
  })();
  return startPromise;
}

// Serialize all synthesis through the main process: only one /tts request is
// ever in flight at a time. This guarantees the server is never hit
// concurrently (which used to crash it), regardless of how fast the renderer
// streams sentences or interrupts.
let chain: Promise<Buffer | null> = Promise.resolve(null);

export function synthesize(text: string): Promise<Buffer | null> {
  const run = chain.then(() => doSynth(text), () => doSynth(text));
  chain = run.catch(() => null);
  return run;
}

async function doSynth(text: string): Promise<Buffer | null> {
  if (!text.trim()) return null;
  const s = settings.get();
  const valid = voices();
  const voice = valid.includes(s.voiceModel) ? s.voiceModel : DEFAULT_VOICE;
  const speed = s.voiceRate || 1.0;
  const key = crypto.createHash('sha1').update(`kokoro|${voice}|${speed}|${text}`).digest('hex');
  const cache = path.join(cacheDir(), key + '.wav');
  if (fs.existsSync(cache)) {
    try {
      return fs.readFileSync(cache);
    } catch {
      /* re-synthesize */
    }
  }

  // Try twice: if the server ever dies mid-request, restart it cleanly and
  // retry once so the SAME sentence still comes out in the neural voice
  // (instead of silently falling back to the robotic OS voice).
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await ensure())) return null;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed }),
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) {
        logger.error('voice', `kokoro tts ${r.status}: ${(await r.text()).slice(0, 160)}`);
        return null;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      try {
        fs.writeFileSync(cache, buf);
      } catch {
        /* ignore cache write */
      }
      return buf;
    } catch (e: any) {
      // Network error usually means the Python server crashed/closed the
      // socket ("terminated"). Tear it down cleanly so ensure() respawns a
      // fresh one, then retry.
      stop();
      if (attempt === 0) {
        logger.info('voice', `kokoro restarting after: ${e.message}`);
        await sleep(400);
        continue;
      }
      logger.error('voice', `kokoro synth failed: ${e.message}`);
      return null;
    }
  }
  return null;
}

export function stop() {
  if (proc) {
    try {
      proc.kill();
    } catch {
      /* */
    }
    proc = null;
    ready = false;
    startPromise = null;
  }
}

export default { available, voices, synthesize, stop };
