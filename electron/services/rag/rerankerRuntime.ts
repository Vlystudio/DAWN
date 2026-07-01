import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import settings from '../settings';
import logger from '../logger';
import runtime from '../runtime';
import { HelperQueue } from './helperQueue';
import clientCore, { RerankCandidateIn, RerankScored, ParseResult } from './rerankerClientCore';
import providerCore, { RerankUnavailableReason } from './rerankerProviderCore';

/**
 * rerankerRuntime.ts — a SEPARATE, dedicated llama.cpp `llama-server` process started with `--reranking` to
 * serve a REAL local GGUF reranker (cross-encoder) via its /rerank endpoint. It runs on its OWN port and its
 * OWN bounded queue, so it never fights the chat model or the helper runtime. Fully local (127.0.0.1).
 *
 * Honesty rules (never faked):
 *  - `ready` requires the process alive AND /health ok AND a real /rerank capability probe that returned a
 *    well-formed relevance score. Reachability alone is NOT treated as reranking support.
 *  - Every "unavailable" is a specific reason (runtime missing / model missing / not ready / api not supported
 *    / server error / timeout). No cross-encoder is ever claimed when the endpoint isn't proven.
 *  - The request client sends the query + candidate text ONLY to this local server, enforces topKInput +
 *    maxCandidateChars, and NEVER logs the query, candidate text, or raw response. Only ids + numeric scores
 *    and safe timings leave this module.
 */

export type RerankerState = 'DISABLED' | 'OFF' | 'STARTING' | 'LOADING' | 'READY' | 'ERROR' | 'STOPPING';

export interface RerankerRuntimeStatus {
  state: RerankerState;
  enabled: boolean;
  configured: boolean;
  running: boolean;
  reachable: boolean;
  endpointSupported: boolean | null;   // null = not yet probed
  apiReason: RerankUnavailableReason;   // capability reason from the last probe
  modelName: string;                    // basename only — never a full path
  port: number;
  endpoint: string | null;
  error: string | null;                 // redacted (no path/prompt/chunk)
  installed: boolean;
  keepWarm: boolean;
  idleStopMs: number;
  warm: boolean;
  lastTestOk: boolean | null;
  lastTestLatencyMs: number | null;
  lastTestSane: boolean | null;         // did the synthetic relevant passage outrank the irrelevant one
  queue: import('./helperQueue').QueueStatus;
}

export interface RerankRunResult {
  ok: boolean;
  scores: RerankScored[] | null;
  ids: string[];
  inputCount: number;
  queueWaitMs: number;
  runMs: number;
  status: string;
  reason?: string;
  cancelled: boolean;
  timeout: boolean;
  lengthMismatch: boolean;
}

function cfg() {
  const s: any = settings.get();
  const g = (s.reranker && s.reranker.gguf) || {};
  return g as {
    enabled?: boolean; modelPath?: string; port?: number; contextSize?: number; threads?: number; gpuLayers?: number;
    batchSize?: number; startupTimeoutMs?: number; requestTimeoutMs?: number; autoStart?: boolean; keepWarm?: boolean;
    idleStopMs?: number; topKInput?: number; topKOutput?: number; maxCandidateChars?: number; queueCapacity?: number; maxConcurrency?: number;
  };
}
const baseName = (p?: string) => String(p || '').split(/[\\/]/).pop() || '';

// The reranker gets its OWN queue instance (distinct role) so heavier rerank work never blocks the
// rewrite/HyDE/entailment helper queue, and vice-versa.
const rerankerQueue = new HelperQueue();

class RerankerRuntimeManager {
  private proc: ChildProcess | null = null;
  private state: RerankerState = 'OFF';
  private port = 0;
  private error: string | null = null;
  private reachable = false;
  private stopping = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastUsedAt = 0;
  private endpointSupported: boolean | null = null;
  private apiReason: RerankUnavailableReason = 'unavailable_runtime_not_ready';
  private rerankPath: string | null = null; // cached working endpoint path (/v1/rerank | /rerank | /reranking)
  private lastTestOk: boolean | null = null;
  private lastTestLatencyMs: number | null = null;
  private lastTestSane: boolean | null = null;
  private startupUnsupported = false; // stderr indicated an unknown `--reranking` flag

  baseUrl() { return `http://127.0.0.1:${this.port}`; }
  isReady() { return this.state === 'READY' && this.reachable && this.endpointSupported === true && !!this.proc; }
  isWarm() { return this.state === 'READY' && this.reachable && !!this.proc; }
  queue() { return rerankerQueue; }

  status(): RerankerRuntimeStatus {
    const c = cfg();
    const installed = !!runtime.exePath();
    let state = this.state;
    if (!c.enabled) state = 'DISABLED';
    return {
      state, enabled: !!c.enabled, configured: !!c.modelPath, running: !!this.proc, reachable: this.reachable,
      endpointSupported: this.endpointSupported, apiReason: this.apiReason,
      modelName: baseName(c.modelPath), port: this.port || Number(c.port) || 8091,
      endpoint: this.port ? this.baseUrl() : null, error: this.error, installed,
      keepWarm: !!c.keepWarm, idleStopMs: Number(c.idleStopMs) > 0 ? Number(c.idleStopMs) : 300000, warm: this.isWarm(),
      lastTestOk: this.lastTestOk, lastTestLatencyMs: this.lastTestLatencyMs, lastTestSane: this.lastTestSane,
      queue: rerankerQueue.status(),
    };
  }

  private setError(msg: string) { this.error = msg; this.state = 'ERROR'; this.reachable = false; logger.warn('reranker-runtime', msg); }

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
    // --reranking puts llama-server into rerank/pooling mode and exposes /rerank. If the build doesn't know
    // the flag it exits at startup → we detect that (stderr) and report unavailable_runtime_unsupported.
    const args = ['-m', model, '--host', '127.0.0.1', '--port', String(port), '-c', String(c.contextSize || 4096), '--reranking'];
    if (c.threads && c.threads > 0) args.push('-t', String(c.threads));
    args.push('-ngl', String(typeof c.gpuLayers === 'number' ? c.gpuLayers : 0)); // CPU by default so it doesn't steal VRAM
    if (c.batchSize && c.batchSize > 0) args.push('-b', String(c.batchSize));
    return args;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    const c = cfg();
    if (!c.enabled) { this.state = 'DISABLED'; return { ok: false, error: 'GGUF reranker is disabled.' }; }
    if (this.proc) return { ok: true }; // duplicate-process guard
    this.error = null; this.reachable = false; this.stopping = false;
    this.endpointSupported = null; this.apiReason = 'unavailable_runtime_not_ready'; this.rerankPath = null; this.startupUnsupported = false;

    const exe = runtime.exePath();
    if (!exe) { this.setError('llama-server.exe not found (resources/runtime).'); this.apiReason = 'unavailable_runtime_missing'; return { ok: false, error: this.error! }; }
    const model = c.modelPath || '';
    if (!model) { this.setError('No reranker model configured.'); this.apiReason = 'unavailable_needs_setup'; return { ok: false, error: this.error! }; }
    if (!fs.existsSync(model)) { this.setError('The configured reranker model file is missing.'); this.apiReason = 'unavailable_model_missing'; return { ok: false, error: this.error! }; }
    if (!/\.gguf$/i.test(model)) { this.setError('The reranker model must be a .gguf file.'); this.apiReason = 'unavailable_model_missing'; return { ok: false, error: this.error! }; }

    rerankerQueue.configure({ capacity: c.queueCapacity || 16, maxConcurrency: c.maxConcurrency || 1 });
    this.port = await this.findPort(Number(c.port) || 8091);
    this.state = 'STARTING';
    const args = this.buildArgs(model, this.port);
    logger.step('reranker-runtime', `Launching reranker ${baseName(exe)} on :${this.port} (model ${baseName(model)}, --reranking)`);
    try {
      this.proc = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) });
    } catch { this.setError('Failed to launch the reranker runtime.'); return { ok: false, error: this.error! }; }

    // Startup logs are model/perf lines (no prompts) — scan only for an unknown-flag signal to be honest
    // about builds that don't support --reranking.
    this.proc.stderr?.on('data', (d) => {
      const line = String(d);
      if (/unknown argument|invalid argument|unrecognized|error: invalid|--reranking/i.test(line) && /reranking|unknown|invalid|unrecognized/i.test(line)) {
        if (/unknown|invalid|unrecognized/i.test(line)) this.startupUnsupported = true;
      }
    });
    this.proc.on('error', () => this.setError('Reranker runtime process error.'));
    this.proc.on('exit', (code, sig) => {
      this.clearHealth(); this.proc = null; this.reachable = false; this.endpointSupported = null;
      if (this.stopping) this.state = 'OFF';
      else if (this.startupUnsupported) { this.setError('This llama-server build does not support --reranking.'); this.apiReason = 'unavailable_runtime_unsupported'; }
      else this.setError(`Reranker runtime exited unexpectedly (code ${code}${sig ? ', ' + sig : ''}). The model may not be a reranker, or too large for the configured memory.`);
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
      if (h === 'ok') {
        this.reachable = true;
        if (this.endpointSupported === null) { await this.probeCapability(); } // verify /rerank once
        if (this.state !== 'READY') { this.state = 'READY'; if (!this.lastUsedAt) this.lastUsedAt = Date.now(); this.startIdleMonitor(); logger.info('reranker-runtime', `reranker reachable; endpoint supported=${this.endpointSupported}`); }
      } else if (h === 'loading') { this.reachable = false; if (this.state !== 'LOADING') this.state = 'LOADING'; }
      else if (Date.now() - t0 > startupTimeoutMs) { this.setError(`Reranker runtime did not become healthy within ${Math.round(startupTimeoutMs / 1000)}s.`); this.clearHealth(); }
    }, 1500);
  }
  private clearHealth() { if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; } }

  private startIdleMonitor() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      const c = cfg();
      if (c.keepWarm) return;
      const idleMs = Number(c.idleStopMs) > 0 ? Number(c.idleStopMs) : 300000;
      if (this.isWarm() && Date.now() - this.lastUsedAt > idleMs) {
        logger.info('reranker-runtime', `reranker idle > ${Math.round(idleMs / 1000)}s — stopping (keepWarm off)`);
        this.stop().catch(() => {});
      }
    }, 15000);
  }
  private clearIdle() { if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; } }

  async health(): Promise<'ok' | 'loading' | 'down'> {
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return 'ok';
      if (res.status === 503) return 'loading';
      return 'down';
    } catch { return 'down'; }
  }

  /** POST to the reranker endpoint (trying known paths) with a strict signal. Returns parsed scores. */
  private async callRerank(built: { query: string; documents: string[]; ids: string[] }, signal: AbortSignal): Promise<ParseResult & { httpReason?: RerankUnavailableReason }> {
    const paths = this.rerankPath ? [this.rerankPath] : ['/v1/rerank', '/rerank', '/reranking'];
    let lastHttpReason: RerankUnavailableReason = 'unavailable_api_not_supported';
    for (const p of paths) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl()}${p}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'dawn', query: built.query, documents: built.documents, top_n: built.documents.length }),
          signal,
        });
      } catch (e: any) {
        if (e?.name === 'AbortError') return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'cancelled' };
        return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'server_error', httpReason: 'unavailable_server_error' };
      }
      if (res.status === 404 || res.status === 405 || res.status === 501) { lastHttpReason = 'unavailable_api_not_supported'; continue; } // try next path
      if (!res.ok) return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'server_error', httpReason: clientCore.httpStatusReason(res.status) as RerankUnavailableReason };
      let raw: any;
      try { raw = await res.json(); } catch { return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'malformed', httpReason: 'unavailable_server_error' }; }
      const parsed = clientCore.parseRerankResponse(raw, built.ids);
      if (parsed.ok) { this.rerankPath = p; return parsed; }
      // Well-formed HTTP but unparseable body → server/model error (not "endpoint missing").
      return { ...parsed, httpReason: 'unavailable_server_error' };
    }
    return { ok: false, scores: null, validCount: 0, lengthMismatch: false, reason: 'api_not_supported', httpReason: lastHttpReason };
  }

  /** Verify the /rerank endpoint with SYNTHETIC public text (never private chunks). Sets endpointSupported. */
  async probeCapability(): Promise<{ ok: boolean; latencyMs: number; reason?: RerankUnavailableReason; sane?: boolean }> {
    const built = { query: 'best fruit for pie', documents: ['Apples are commonly used in pie.', 'Cars require oil changes.'], ids: ['A', 'B'] };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), Math.max(1000, cfg().requestTimeoutMs || 10000));
    const t0 = Date.now();
    let r: ParseResult & { httpReason?: RerankUnavailableReason };
    try { r = await this.callRerank(built, ctrl.signal); } finally { clearTimeout(to); }
    const latencyMs = Date.now() - t0;
    this.lastTestLatencyMs = latencyMs;
    if (r.ok && r.scores) {
      this.endpointSupported = true; this.apiReason = 'none'; this.lastTestOk = true;
      const a = r.scores.find((s) => s.id === 'A')?.score ?? null;
      const b = r.scores.find((s) => s.id === 'B')?.score ?? null;
      this.lastTestSane = a !== null && b !== null ? a > b : null; // relevant passage should outrank the irrelevant one
      return { ok: true, latencyMs, sane: this.lastTestSane ?? undefined };
    }
    this.endpointSupported = false; this.lastTestOk = false; this.lastTestSane = null;
    this.apiReason = r.reason === 'cancelled' ? 'unavailable_timeout' : (r.httpReason || 'unavailable_api_not_supported');
    return { ok: false, latencyMs, reason: this.apiReason };
  }

  /**
   * Rerank candidates for a query THROUGH the reranker queue (serialized, cancellable, generation-aware).
   * Returns ids + numeric scores + safe timings only. Never throws; honest failure reasons.
   */
  async rerank(query: string, candidates: RerankCandidateIn[], opts: { generation?: number } = {}): Promise<RerankRunResult> {
    const c = cfg();
    const built = clientCore.buildRerankRequest(query, candidates, { topKInput: c.topKInput || 30, maxCandidateChars: c.maxCandidateChars || 4000 });
    const empty: RerankRunResult = { ok: false, scores: null, ids: built.ids, inputCount: built.inputCount, queueWaitMs: 0, runMs: 0, status: 'unavailable', cancelled: false, timeout: false, lengthMismatch: false };
    if (!this.isReady()) return { ...empty, reason: this.error || 'reranker not ready' };
    if (!built.inputCount) return { ...empty, ok: false, status: 'skipped', reason: 'no candidates' };

    let parsed: (ParseResult & { httpReason?: RerankUnavailableReason }) | null = null;
    const q = await rerankerQueue.run('reranker', 'normal', async (sig) => {
      parsed = await this.callRerank(built, sig);
      this.lastUsedAt = Date.now();
      return { ok: parsed.ok, reason: parsed.reason };
    }, { timeoutMs: c.requestTimeoutMs || 10000, generation: opts.generation });

    const cancelled = q.status === 'cancelled' || q.status === 'superseded';
    const timeout = q.status === 'timeout';
    const ok = q.ok && !!parsed && parsed.ok;
    return {
      ok, scores: ok && parsed ? parsed.scores : null, ids: built.ids, inputCount: built.inputCount,
      queueWaitMs: q.queueWaitMs, runMs: q.runMs, status: q.status,
      reason: q.reason || (parsed ? parsed.reason : undefined), cancelled, timeout,
      lengthMismatch: !!parsed && parsed.lengthMismatch,
    };
  }

  async stop(): Promise<void> {
    rerankerQueue.clear('runtime_stopped'); // cancel any in-flight/queued rerank jobs — no orphan work
    this.clearIdle();
    if (!this.proc) { this.state = cfg().enabled ? 'OFF' : 'DISABLED'; return; }
    this.stopping = true; this.state = 'STOPPING'; this.clearHealth();
    const p = this.proc;
    try { p.kill(); } catch { /* */ }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { if (p.pid) execFile('taskkill', ['/PID', String(p.pid), '/T', '/F'], () => resolve()); else resolve(); }, 5000);
      p.once('exit', () => { clearTimeout(t); resolve(); });
    });
    this.proc = null; this.reachable = false; this.endpointSupported = null; this.state = 'OFF';
  }

  async restart(): Promise<{ ok: boolean; error?: string }> { await this.stop(); return this.start(); }

  async maybeAutoStart() {
    const c = cfg();
    try { if (c.enabled && c.autoStart && !this.proc) await this.start(); } catch { /* optional */ }
  }

  /** User-triggered "Test reranker": SYNTHETIC public text only (never private chunks). Redacted result. */
  async test(): Promise<{ ok: boolean; latencyMs?: number; sane?: boolean | null; scores?: { a: number | null; b: number | null }; error?: string; endpointSupported: boolean | null }> {
    if (!cfg().enabled) return { ok: false, error: 'GGUF reranker is disabled.', endpointSupported: this.endpointSupported };
    if (!this.reachable) return { ok: false, error: this.error || 'Reranker runtime is not running.', endpointSupported: this.endpointSupported };
    const built = { query: 'best fruit for pie', documents: ['Apples are commonly used in pie.', 'Cars require oil changes.'], ids: ['A', 'B'] };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), Math.max(1000, cfg().requestTimeoutMs || 10000));
    const t0 = Date.now();
    let r: ParseResult & { httpReason?: RerankUnavailableReason };
    try { r = await this.callRerank(built, ctrl.signal); } finally { clearTimeout(to); }
    const latencyMs = Date.now() - t0;
    this.lastTestLatencyMs = latencyMs;
    if (r.ok && r.scores) {
      this.endpointSupported = true; this.apiReason = 'none'; this.lastTestOk = true;
      const a = r.scores.find((s) => s.id === 'A')?.score ?? null;
      const b = r.scores.find((s) => s.id === 'B')?.score ?? null;
      this.lastTestSane = a !== null && b !== null ? a > b : null;
      try { require('./helperAnalyticsCore').default.record({ role: 'reranker', provider: 'gguf_reranker', status: 'completed', runMs: latencyMs, reason: 'test' }); } catch { /* */ }
      return { ok: true, latencyMs, sane: this.lastTestSane, scores: { a, b }, endpointSupported: true };
    }
    this.endpointSupported = false; this.lastTestOk = false;
    this.apiReason = r.reason === 'cancelled' ? 'unavailable_timeout' : (r.httpReason || 'unavailable_api_not_supported');
    try { require('./helperAnalyticsCore').default.record({ role: 'reranker', provider: 'gguf_reranker', status: 'failed', runMs: latencyMs, reason: this.apiReason }); } catch { /* */ }
    return { ok: false, latencyMs, error: providerCore.reasonLabel(this.apiReason), endpointSupported: false };
  }

  /** Merge + persist reranker.gguf settings, then restart if enabled so config changes take effect. */
  async updateSettings(patch: any): Promise<{ ok: boolean; status: RerankerRuntimeStatus }> {
    const s: any = settings.get();
    const cur = (s.reranker && s.reranker.gguf) || {};
    settings.save({ reranker: { ...(s.reranker || {}), gguf: { ...cur, ...(patch || {}) } } } as any);
    if (cfg().enabled) await this.restart(); else await this.stop();
    return { ok: true, status: this.status() };
  }

  cancelJobs() { rerankerQueue.cancelAll('cancelled'); return rerankerQueue.status(); }
  clearQueue() { rerankerQueue.clear('cleared'); return rerankerQueue.status(); }
  /** Supersede reranker jobs older than the current chat generation (generation-aware cancellation). */
  beginGeneration() { return rerankerQueue.beginGeneration(); }
}

const rerankerRuntime = new RerankerRuntimeManager();
export default rerankerRuntime;
export { rerankerQueue };
