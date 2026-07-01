import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import settings from '../settings';
import logger from '../logger';
import runtime from '../runtime';
import * as llama from '../llama';
import hmCore from './helperModelCore';

/**
 * helperRuntime.ts — a SECOND, dedicated llama.cpp `llama-server` process for retrieval HELPER tasks
 * (query rewrite / HyDE / entailment). It runs a small local model on its OWN port so those tasks do
 * NOT compete with, block, or replace the active chat model. Purpose-built for helper use: no
 * model-switching, no GENERATING state, CPU-by-default (so it doesn't take VRAM from the chat model),
 * strict timeouts, honest status. Fully local (127.0.0.1) — never cloud.
 *
 * Honesty rules: `READY`/`reachable` are only ever true when the process is alive AND /health returns
 * 200. There is no fake "running". If disabled/unconfigured/crashed, callers fall back honestly. The
 * request client never logs prompts or responses, so private retrieved content can't leak.
 */

export type HelperState = 'DISABLED' | 'OFF' | 'STARTING' | 'LOADING' | 'READY' | 'ERROR' | 'STOPPING';

export interface HelperStatus {
  state: HelperState;
  enabled: boolean;
  configured: boolean;  // a model path is set
  running: boolean;     // the process is alive
  reachable: boolean;   // last /health was 200
  modelName: string;    // basename only — never the full path
  port: number;
  error: string | null; // redacted, no path
  installed: boolean;   // llama-server.exe present
}

function cfg() {
  const s: any = settings.get();
  return (s.helperRuntime || {}) as {
    enabled?: boolean; modelPath?: string; port?: number; contextSize?: number; threads?: number;
    gpuLayers?: number; batchSize?: number; startupTimeoutMs?: number; requestTimeoutMs?: number; autoStart?: boolean;
  };
}
const baseName = (p?: string) => String(p || '').split(/[\\/]/).pop() || '';

class HelperRuntimeManager {
  private proc: ChildProcess | null = null;
  private state: HelperState = 'OFF';
  private port = 0;
  private error: string | null = null;
  private reachable = false;
  private stopping = false;
  private healthTimer: NodeJS.Timeout | null = null;

  baseUrl() { return `http://127.0.0.1:${this.port}`; }
  isReady() { return this.state === 'READY' && this.reachable && !!this.proc; }

  status(): HelperStatus {
    const c = cfg();
    const installed = !!runtime.exePath();
    let state = this.state;
    if (!c.enabled) state = 'DISABLED';
    return {
      state,
      enabled: !!c.enabled,
      configured: !!c.modelPath,
      running: !!this.proc,
      reachable: this.reachable,
      modelName: baseName(c.modelPath),
      port: this.port || Number(c.port) || 8090,
      error: this.error,
      installed,
    };
  }

  private setError(msg: string) { this.error = msg; this.state = 'ERROR'; this.reachable = false; logger.warn('helper-runtime', msg); }

  private findPort(preferred: number): Promise<number> {
    const tryPort = (p: number) => new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p, '127.0.0.1');
    });
    return (async () => {
      for (let p = preferred; p < preferred + 40; p++) if (await tryPort(p)) return p;
      return preferred;
    })();
  }

  private buildArgs(model: string, port: number): string[] {
    const c = cfg();
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(c.contextSize || 4096)];
    if (c.threads && c.threads > 0) args.push('-t', String(c.threads));
    args.push('-ngl', String(typeof c.gpuLayers === 'number' ? c.gpuLayers : 0)); // CPU by default so it doesn't steal VRAM from the chat model
    if (c.batchSize && c.batchSize > 0) args.push('-b', String(c.batchSize));
    return args;
  }

  /** Start the dedicated helper server. Validates enabled/config/model/exe; no-op if already running. */
  async start(): Promise<{ ok: boolean; error?: string }> {
    const c = cfg();
    if (!c.enabled) { this.state = 'DISABLED'; return { ok: false, error: 'Helper runtime is disabled.' }; }
    if (this.proc) return { ok: true }; // avoid duplicate helper processes
    this.error = null; this.reachable = false; this.stopping = false;

    const exe = runtime.exePath();
    if (!exe) { this.setError('llama-server.exe not found (resources/runtime).'); return { ok: false, error: this.error! }; }
    const model = c.modelPath || '';
    if (!model) { this.setError('No helper model configured.'); return { ok: false, error: this.error! }; }
    if (!fs.existsSync(model)) { this.setError('The configured helper model file is missing.'); return { ok: false, error: this.error! }; }
    if (!/\.gguf$/i.test(model)) { this.setError('The helper model must be a .gguf file.'); return { ok: false, error: this.error! }; }

    this.port = await this.findPort(Number(c.port) || 8090);
    this.state = 'STARTING';
    const args = this.buildArgs(model, this.port);
    logger.step('helper-runtime', `Launching helper ${baseName(exe)} on :${this.port} (model ${baseName(model)})`);
    try {
      this.proc = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
    } catch (e: any) { this.setError('Failed to launch the helper runtime.'); return { ok: false, error: this.error! }; }

    // llama-server logs are model/perf lines (no prompts) — safe to log at debug level.
    this.proc.stderr?.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).slice(0, 1).forEach(() => { /* keep quiet; health drives state */ }));
    this.proc.on('error', () => this.setError('Helper runtime process error.'));
    this.proc.on('exit', (code, sig) => {
      this.clearHealth(); this.proc = null; this.reachable = false;
      if (this.stopping) this.state = 'OFF';
      else this.setError(`Helper runtime exited unexpectedly (code ${code}${sig ? ', ' + sig : ''}). The model may be too large for the configured GPU layers/memory.`);
    });

    this.state = 'LOADING';
    this.startHealthLoop(c.startupTimeoutMs || 60000);
    return { ok: true };
  }

  private startHealthLoop(startupTimeoutMs: number) {
    this.clearHealth();
    const t0 = Date.now();
    this.healthTimer = setInterval(async () => {
      if (!this.proc) { this.clearHealth(); return; }
      const h = await this.health();
      if (h === 'ok') { this.reachable = true; if (this.state !== 'READY') { this.state = 'READY'; logger.info('helper-runtime', 'helper model ready'); } }
      else if (h === 'loading') { this.reachable = false; if (this.state !== 'LOADING') this.state = 'LOADING'; }
      else if (Date.now() - t0 > startupTimeoutMs) { this.setError(`Helper runtime did not become healthy within ${Math.round(startupTimeoutMs / 1000)}s.`); this.clearHealth(); }
    }, 1500);
  }
  private clearHealth() { if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; } }

  async health(): Promise<'ok' | 'loading' | 'down'> {
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return 'ok';
      if (res.status === 503) return 'loading';
      return 'down';
    } catch { return 'down'; }
  }

  async stop(): Promise<void> {
    if (!this.proc) { this.state = cfg().enabled ? 'OFF' : 'DISABLED'; return; }
    this.stopping = true; this.state = 'STOPPING'; this.clearHealth();
    const p = this.proc;
    try { p.kill(); } catch { /* */ }
    await new Promise<void>((resolve) => {
      const to = setTimeout(() => { if (p.pid) execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], () => resolve()); else resolve(); }, 5000);
      p.once('exit', () => { clearTimeout(to); resolve(); });
    });
    this.proc = null; this.reachable = false; this.state = 'OFF';
  }

  async restart(): Promise<{ ok: boolean; error?: string }> { await this.stop(); return this.start(); }

  /** Auto-start on boot / settings change if enabled + autoStart. Never throws. */
  async maybeAutoStart() {
    const c = cfg();
    try { if (c.enabled && c.autoStart && !this.proc) await this.start(); } catch { /* */ }
  }

  /**
   * The SAFE helper request client: a one-shot chat call to the helper server with a strict timeout.
   * Never logs the prompt or response. Returns an honest failure when the server is unreachable.
   */
  async callHelper(prompt: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<{ ok: boolean; text?: string; reason?: string }> {
    if (!this.isReady()) return { ok: false, reason: 'helper runtime not ready' };
    const c = cfg();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), c.requestTimeoutMs || 8000);
    try {
      const text = await llama.chat(this.baseUrl(), [{ role: 'user', content: prompt }], { temperature: opts.temperature ?? 0.2, max_tokens: opts.maxTokens ?? 200 }, ctrl.signal);
      return { ok: true, text };
    } catch (e: any) {
      return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'helper request failed' };
    } finally { clearTimeout(to); }
  }

  /** Per-role provider status (which provider each helper task would currently use). Honest. */
  roles(): { task: string; provider: string; reason: string }[] {
    const s: any = settings.get();
    const enabled = !!s.helperRuntime?.enabled;
    const ready = this.isReady();
    const chatReady = runtime.isReady();
    const preferChatFallback = s.helperModels?.preferChatModelFallback !== false;
    const mk = (task: any, taskEnabled: boolean, lexicalFallback = false) => {
      const r = hmCore.resolveHelperTask({ task, taskEnabled, helperRuntimeEnabled: enabled, helperRuntimeReady: ready, chatReady, preferChatFallback, lexicalFallback });
      return { task, provider: r.provider, reason: r.reason };
    };
    return [
      mk('query_rewrite', !!s.queryRewriteEnabled),
      mk('hyde', !!s.hydeEnabled),
      mk('entailment', !!s.entailmentEnabled, true),
      // Reranking is embedding-similarity/heuristic — NOT generative — so it does not use the helper runtime (honest, not a cross-encoder).
      { task: 'reranker', provider: s.rerankerEnabled ? 'embedding' : 'disabled', reason: 'embedding-similarity rerank — the helper runtime does generative tasks only, not cross-encoder scoring' },
    ];
  }

  /** Merge + persist helperRuntime settings, then restart if enabled (so config changes take effect). */
  async updateSettings(patch: any): Promise<{ ok: boolean; status: HelperStatus }> {
    const cur = cfg();
    settings.save({ helperRuntime: { ...cur, ...(patch || {}) } } as any);
    if (cfg().enabled) await this.restart(); else await this.stop();
    return { ok: true, status: this.status() };
  }

  /** User-triggered "Test Helper Runtime": tiny request → latency + provider + model, redacted error. */
  async test(): Promise<{ ok: boolean; latencyMs?: number; provider: string; model: string; error?: string }> {
    const model = baseName(cfg().modelPath);
    if (!cfg().enabled) return { ok: false, provider: 'helper_runtime', model, error: 'Helper runtime is disabled.' };
    if (!this.isReady()) return { ok: false, provider: 'helper_runtime', model, error: this.error || 'Helper runtime is not running.' };
    const t0 = Date.now();
    const r = await this.callHelper('Reply with the single word: OK', { maxTokens: 8 });
    if (r.ok) return { ok: true, latencyMs: Date.now() - t0, provider: 'helper_runtime', model };
    return { ok: false, provider: 'helper_runtime', model, error: r.reason || 'Helper request failed.' };
  }
}

const helperRuntime = new HelperRuntimeManager();
export default helperRuntime;
