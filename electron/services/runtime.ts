import { EventEmitter } from 'events';
import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { app } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * DawnRuntimeManager — owns the bundled llama.cpp `llama-server.exe` process.
 *
 * Fully local: launches the server bound to 127.0.0.1 only, loads the selected
 * GGUF, watches health (/health: 200 ok, 503 loading), captures stdout/stderr,
 * detects the active backend (CUDA/Vulkan/CPU), picks a free port if the
 * configured one is busy, and shuts down gracefully (force-kill only as a last
 * resort). No Ollama, no Docker, no cloud.
 */

export type RuntimeState = 'OFF' | 'STARTING' | 'LOADING_MODEL' | 'READY' | 'GENERATING' | 'ERROR' | 'STOPPING';

export interface RuntimeStatus {
  state: RuntimeState;
  port: number;
  backend: string; // CUDA | Vulkan | CPU | Unknown
  model: string;
  error: string | null;
  installed: boolean; // llama-server.exe present
  hasModel: boolean; // a model is selected and exists
}

class DawnRuntimeManager extends EventEmitter {
  state: RuntimeState = 'OFF';
  private proc: ChildProcess | null = null;
  port = 0;
  backend = 'Unknown';
  model = '';
  error: string | null = null;
  logs: { line: string; stream: string; ts: number }[] = [];
  private healthTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  // --- discovery -----------------------------------------------------------

  /** Locate llama-server.exe: explicit override → packaged resources → dev resources. */
  exePath(): string {
    const s = settings.get();
    if (s.runtimeExePath && fs.existsSync(s.runtimeExePath)) return s.runtimeExePath;
    const names = ['llama-server.exe', 'server.exe'];
    const dirs = [
      path.join(process.resourcesPath || '', 'runtime'),
      path.join(app.getAppPath(), 'resources', 'runtime'),
      path.join(app.getAppPath(), '..', 'resources', 'runtime'),
      path.join(process.cwd(), 'resources', 'runtime'),
    ];
    for (const d of dirs) for (const n of names) {
      const p = path.join(d, n);
      if (p && fs.existsSync(p)) return p;
    }
    return '';
  }

  isInstalled() {
    return !!this.exePath();
  }
  hasModel() {
    const m = settings.get().modelPath;
    return !!m && fs.existsSync(m);
  }

  getStatus(): RuntimeStatus {
    return {
      state: this.state, port: this.port, backend: this.backend, model: this.model || settings.get().modelPath,
      error: this.error, installed: this.isInstalled(), hasModel: this.hasModel(),
    };
  }

  baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }
  isReady() {
    return this.state === 'READY' || this.state === 'GENERATING';
  }

  // --- lifecycle -----------------------------------------------------------

  private setState(state: RuntimeState, detail?: string) {
    this.state = state;
    logger.info('runtime', `state=${state}${detail ? ' — ' + detail : ''}`);
    this.emit('state', { ...this.getStatus(), detail });
  }

  private addLog(line: string, stream: string) {
    const entry = { line, stream, ts: Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 1500) this.logs.shift();
    if (/cuda/i.test(line)) this.backend = 'CUDA';
    else if (/vulkan/i.test(line)) this.backend = 'Vulkan';
    else if (this.backend === 'Unknown' && /\b(cpu)\b/i.test(line)) this.backend = 'CPU';
    logger.log(stream === 'stderr' ? 'warn' : 'info', 'llama', line);
    this.emit('log', entry);
  }

  getLogs() {
    return this.logs;
  }

  /** Find an available local port, starting at `preferred`. */
  private findPort(preferred: number): Promise<number> {
    const tryPort = (p: number): Promise<boolean> =>
      new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(p, '127.0.0.1');
      });
    return (async () => {
      for (let p = preferred; p < preferred + 50; p++) {
        if (await tryPort(p)) {
          if (p !== preferred) {
            logger.warn('runtime', `Port ${preferred} busy — using ${p}.`);
            this.emit('port-conflict', { requested: preferred, chosen: p });
          }
          return p;
        }
      }
      return preferred;
    })();
  }

  private buildArgs(model: string, port: number): string[] {
    const s = settings.get();
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(s.contextLength || 4096)];
    if (s.threads && s.threads > 0) args.push('-t', String(s.threads));
    const ngl = s.lowVram || s.performanceMode === 'cpu' ? 0 : s.gpuLayers || (s.performanceMode === 'high' ? 999 : 0);
    args.push('-ngl', String(ngl));
    if (s.batchSize) args.push('-b', String(s.batchSize));
    return args;
  }

  /** Start the runtime: validate, pick port, spawn, then health-watch. */
  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.proc) return { ok: true };
    this.error = null;
    this.stopping = false;
    this.backend = 'Unknown';

    const exe = this.exePath();
    if (!exe) {
      this.error = 'llama-server.exe not found. Add it to resources/runtime (see docs), or set its path in Runtime Settings.';
      this.setState('ERROR', this.error);
      return { ok: false, error: this.error };
    }
    const model = settings.get().modelPath;
    if (!model || !fs.existsSync(model)) {
      this.error = 'No GGUF model selected. Import and select one in Model Manager.';
      this.setState('ERROR', this.error);
      return { ok: false, error: this.error };
    }
    this.model = model;
    this.port = await this.findPort(settings.get().runtimePort || 8080);
    this.setState('STARTING', `port ${this.port}`);

    const args = this.buildArgs(model, this.port);
    logger.step('runtime', `Launching ${path.basename(exe)} ${args.join(' ')}`);
    try {
      this.proc = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
    } catch (e: any) {
      this.error = `Failed to launch runtime: ${e.message}`;
      this.setState('ERROR', this.error);
      return { ok: false, error: this.error };
    }

    this.proc.stdout?.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => this.addLog(l, 'stdout')));
    this.proc.stderr?.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => this.addLog(l, 'stderr')));
    this.proc.on('error', (e) => {
      this.error = `Runtime process error: ${e.message}`;
      this.setState('ERROR', this.error);
    });
    this.proc.on('exit', (code, sig) => {
      this.clearHealth();
      this.proc = null;
      if (this.stopping) {
        this.setState('OFF');
      } else {
        this.error = `Runtime exited unexpectedly (code ${code}${sig ? ', ' + sig : ''}). Check Logs — the model may be too large for available memory, or the GPU backend failed.`;
        this.setState('ERROR', this.error);
      }
    });

    this.setState('LOADING_MODEL');
    this.startHealthLoop();
    return { ok: true };
  }

  private startHealthLoop() {
    this.clearHealth();
    const t0 = Date.now();
    this.healthTimer = setInterval(async () => {
      if (!this.proc) return;
      const h = await this.health();
      if (h === 'ok') {
        if (this.state !== 'READY' && this.state !== 'GENERATING') {
          this.setState('READY', 'model loaded');
          this.emit('model-loaded', this.getStatus());
        }
      } else if (h === 'loading') {
        if (this.state !== 'LOADING_MODEL') this.setState('LOADING_MODEL');
      } else if (Date.now() - t0 > 180000) {
        this.error = 'Runtime did not become healthy within 3 minutes.';
        this.setState('ERROR', this.error);
        this.clearHealth();
      }
    }, 1500);
  }

  private clearHealth() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  async health(): Promise<'ok' | 'loading' | 'down'> {
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return 'ok';
      if (res.status === 503) return 'loading';
      return 'down';
    } catch {
      return 'down';
    }
  }

  setGenerating(on: boolean) {
    if (on && this.state === 'READY') this.setState('GENERATING');
    else if (!on && this.state === 'GENERATING') this.setState('READY');
  }

  /** Graceful stop; force-kill the process tree only if it doesn't exit. */
  async stop(): Promise<void> {
    if (!this.proc) {
      this.setState('OFF');
      return;
    }
    this.stopping = true;
    this.setState('STOPPING');
    this.clearHealth();
    const p = this.proc;
    try {
      p.kill();
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      const to = setTimeout(() => {
        if (p.pid) {
          execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], () => resolve());
        } else resolve();
      }, 5000);
      p.once('exit', () => {
        clearTimeout(to);
        resolve();
      });
    });
    this.proc = null;
    this.setState('OFF');
  }

  async restart(): Promise<{ ok: boolean; error?: string }> {
    await this.stop();
    return this.start();
  }

  /**
   * Seamlessly switch the loaded model — no manual power-off/on. Selects the
   * model, then (if the runtime is up) hot-swaps by restarting the server with
   * it; if it's off, starts it with the new model. Chat history is unaffected.
   */
  async switchModel(modelPath: string): Promise<{ ok: boolean; error?: string }> {
    if (!modelPath) return { ok: false, error: 'No model specified.' };
    const prev = settings.get().modelPath;
    if (modelPath === prev && this.isReady()) return { ok: true }; // already loaded
    settings.save({ modelPath });
    this.model = modelPath;
    if (this.proc) return this.restart(); // running/loading -> swap
    return this.start(); // off -> bring it up with the chosen model
  }
}

export default new DawnRuntimeManager();
