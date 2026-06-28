import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { app } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * vision.ts — manages DAWN's Live Vision Python sidecar (resources/vision), which
 * owns the webcam and runs YOLO + OCR over 127.0.0.1. Mirrors the Kokoro voice
 * service: located + spawned lazily, polled for VISION_READY, driven over HTTP.
 * Camera is OFF until start(); the renderer shows the MJPEG from previewUrl().
 */

function visionDir(): string {
  const dirs = [
    path.join(process.resourcesPath || '', 'vision'),
    path.join(app.getAppPath(), 'resources', 'vision'),
    path.join(app.getAppPath(), '..', 'resources', 'vision'),
    path.join(process.cwd(), 'resources', 'vision'),
  ];
  for (const d of dirs) if (d && fs.existsSync(path.join(d, 'vision_manager.py'))) return d;
  return '';
}
function pyExe() {
  const d = visionDir();
  return d ? path.join(d, 'venv', 'Scripts', 'python.exe') : '';
}
function modelPath() {
  return path.join(visionDir(), 'models', 'yolov8n.onnx');
}

export function available(): boolean {
  const d = visionDir();
  return !!d && fs.existsSync(pyExe()) && fs.existsSync(path.join(d, 'vision_manager.py'));
}
export function hasModel(): boolean {
  return fs.existsSync(modelPath());
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

export function previewUrl(): string {
  return port ? `http://127.0.0.1:${port}/preview` : '';
}
function base() {
  return `http://127.0.0.1:${port}`;
}

/** Start the sidecar (once) and wait until healthy. */
async function ensure(): Promise<boolean> {
  if (ready) return true;
  if (!available()) return false;
  if (startPromise) return startPromise;
  startPromise = (async () => {
    port = await findFreePort(8231);
    logger.step('vision', `Starting Live Vision sidecar on 127.0.0.1:${port}…`);
    proc = spawn(pyExe(), [path.join(visionDir(), 'vision_manager.py'), '--port', String(port), '--model', modelPath()], {
      cwd: visionDir(),
      windowsHide: true,
    });
    proc.stderr?.on('data', (d) => {
      const s = String(d).trim();
      if (s && !/VISION_READY/.test(s)) logger.info('vision', `py: ${s.slice(0, 200)}`);
    });
    proc.on('exit', () => { ready = false; proc = null; startPromise = null; });
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (!proc) break;
      try {
        const r = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) { ready = true; logger.info('vision', 'Live Vision ready.'); return true; }
      } catch { /* not up */ }
      await sleep(800);
    }
    logger.error('vision', 'Vision sidecar did not become healthy.');
    return false;
  })();
  return startPromise;
}

async function post(p: string, body?: any): Promise<any> {
  if (!(await ensure())) return { ok: false, error: 'vision sidecar unavailable' };
  try {
    const r = await fetch(`${base()}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    return await r.json();
  } catch (e: any) { return { ok: false, error: e.message }; }
}
async function get(p: string): Promise<any> {
  if (!(await ensure())) return null;
  try {
    const r = await fetch(`${base()}${p}`, { signal: AbortSignal.timeout(15000) });
    return await r.json();
  } catch { return null; }
}

export async function listCameras() { return (await get('/cameras')) || []; }

export async function start() {
  const s = settings.get();
  return post('/start', { device: s.visionDevice, width: s.visionWidth, height: s.visionHeight, fps: s.visionFps, conf: s.visionConf, draw: true });
}
export async function stop() { return post('/stop'); }

export async function status() {
  const st = (await get('/status')) || { running: false };
  return { ...st, port, previewUrl: previewUrl() };
}
export async function detections() { return (await get('/detections')) || { objects: [] }; }
export async function context() { return (await get('/context')) || {}; }
export async function ocr() { return post('/ocr'); }
export async function forget() { return post('/forget'); }

/** Latest raw frame as a base64 data URL (for the VLM / chat). */
export async function frameDataUrl(): Promise<string | null> {
  if (!(await ensure())) return null;
  try {
    const r = await fetch(`${base()}/frame`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch { return null; }
}

export async function snapshot(annotated = false): Promise<{ ok: boolean; path?: string; error?: string }> {
  const s = settings.get();
  if (!s.visionSaveSnapshots) return { ok: false, error: 'Snapshot saving is disabled in settings.' };
  const dir = s.visionSnapshotDir || path.join(app.getPath('userData'), 'vision', 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `dawn-vision-${Date.now()}.jpg`);
  return post('/snapshot', { path: file, annotated });
}

export function stopServer() {
  if (proc) { try { proc.kill(); } catch { /* */ } proc = null; ready = false; startPromise = null; }
}

export default { available, hasModel, listCameras, start, stop, status, detections, context, ocr, forget, frameDataUrl, snapshot, previewUrl, stopServer };
