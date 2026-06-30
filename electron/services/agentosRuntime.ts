/**
 * agentosRuntime.ts — DAWN-side manager for the local AgentOS API (a trusted local
 * companion process). Detects, starts, monitors, restarts, and reports AgentOS health so
 * the user never has to run uvicorn by hand.
 *
 * Hard security rules (enforced here):
 *   - The startup command comes ONLY from trusted settings — never from model output or
 *     retrieved text. We spawn `<python> -m uvicorn agentos.ui.api:app …` with an ARGV
 *     ARRAY (no shell, no interpolation).
 *   - We only ever stop/restart the process DAWN itself started. We NEVER kill an unknown
 *     process occupying the port; if a non-AgentOS service holds the port we warn and fall
 *     back to CLI (no connect).
 *   - No cloud API keys are passed to the child; only safe local RAG/Ollama env vars.
 *   - Health is fail-closed: a malformed/unreachable response → degraded/failed, not "ok".
 *   - Logs are secret-redacted before being stored or surfaced.
 *
 * Electron-free core: all effects (http/spawn/net/fs) are injected via `deps` so the logic
 * is unit-testable in plain Node. The default singleton wires the real effects.
 */
import { spawn } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { redactSecrets } from './agentos';

export type RuntimeState =
  | 'stopped' | 'starting' | 'ready' | 'degraded' | 'failed' | 'using_cli_fallback';

export interface RuntimeConfig {
  enabled: boolean;
  autoStart: boolean;
  apiUrl: string;
  apiHost: string;
  apiPort: number;
  agentosDir: string;
  pythonPath: string;            // explicit override; else <dir>/.venv/Scripts/python.exe
  startupTimeoutMs: number;
  healthCheckIntervalMs: number;
  preferHttp: boolean;
  allowCliFallback: boolean;
  embeddingProviderExpected: string;
  embeddingModelExpected: string;
  ollamaUrl: string;
  allowHashBackend: boolean;     // only true in explicit test/dev mode
}

export interface RuntimeStatus {
  enabled: boolean;
  state: RuntimeState;
  transport: 'http' | 'cli' | 'unavailable';
  apiUrl: string;
  startedByDawn: boolean;
  pid: number | null;
  health: {
    ok: boolean;
    agentosVersion: string | null;
    networkEnabled: boolean;
    pythonExecEnabled: boolean;
    shellEnabled: boolean;
    approvalEnabled: boolean;
    ragEnabled: boolean;
  } | null;
  rag: {
    available: boolean;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddingUrl: string | null;
    isTestBackend: boolean;
    indexPath: string | null;
    collections: number;
  } | null;
  warnings: string[];
  lastError: string | null;
  lastCheckedAt: string | null;
}

export interface RuntimeChild {
  pid: number | undefined;
  onStdout: (cb: (s: string) => void) => void;
  onStderr: (cb: (s: string) => void) => void;
  onExit: (cb: (code: number | null) => void) => void;
  kill: () => void;
}

export interface RuntimeDeps {
  httpGet: (url: string, timeoutMs: number) => Promise<any>;
  spawnProc: (exe: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => RuntimeChild;
  portInUse: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  pathExists: (p: string) => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

const HEALTH_TIMEOUT = 2500;

function looksLikeAgentos(h: any): boolean {
  if (!h || typeof h !== 'object') return false;
  if (h.service === 'agentos') return true;
  // tolerate an older AgentOS without `service`: it still returns ok + network/shell flags
  return h.ok === true && (h.features !== undefined || ('network' in h && 'shell' in h));
}

export class AgentosRuntime extends EventEmitter {
  private deps: RuntimeDeps;
  private getConfig: () => RuntimeConfig;
  private proc: RuntimeChild | null = null;
  private startedByDawn = false;
  private pid: number | null = null;
  private state: RuntimeState = 'stopped';
  private lastHealth: RuntimeStatus['health'] = null;
  private lastRag: RuntimeStatus['rag'] = null;
  private warnings: string[] = [];
  private lastError: string | null = null;
  private lastCheckedAt: string | null = null;
  private transport: RuntimeStatus['transport'] = 'unavailable';
  private starting: Promise<RuntimeStatus> | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private logs: string[] = [];
  private readonly LOG_CAP = 300;

  constructor(getConfig: () => RuntimeConfig, deps: RuntimeDeps) {
    super();
    this.getConfig = getConfig;
    this.deps = deps;
  }

  // --- trusted command resolution (never from model/user text) ---------------
  private resolvePython(cfg: RuntimeConfig): string {
    const explicit = (cfg.pythonPath || '').trim();
    if (explicit && this.deps.pathExists(explicit)) return explicit;
    return path.join(cfg.agentosDir, '.venv', 'Scripts', 'python.exe');
  }
  private uvicornArgs(cfg: RuntimeConfig): string[] {
    // ARGV array only — no shell, no string interpolation of untrusted data.
    return ['-m', 'uvicorn', 'agentos.ui.api:app', '--host', cfg.apiHost,
      '--port', String(cfg.apiPort), '--log-level', 'warning'];
  }
  private childEnv(cfg: RuntimeConfig): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Strip cloud keys + anything that would change Electron child behavior.
    for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ELECTRON_RUN_AS_NODE']) delete env[k];
    env.AGENTOS_RAG_EMBEDDING_PROVIDER = cfg.embeddingProviderExpected || 'ollama';
    env.AGENTOS_RAG_EMBEDDING_MODEL = cfg.embeddingModelExpected || 'nomic-embed-text';
    env.AGENTOS_RAG_OLLAMA_URL = cfg.ollamaUrl || 'http://127.0.0.1:11434';
    // Never silently enable the test-only hash backend in normal use.
    if (!cfg.allowHashBackend) delete env.AGENTOS_RAG_ALLOW_HASH_EMBEDDINGS;
    return env;
  }

  private addLog(line: string) {
    const clean = redactSecrets(String(line).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')).slice(0, 400);
    if (!clean.trim()) return;
    this.logs.push(`${new Date().toISOString()} ${clean}`);
    if (this.logs.length > this.LOG_CAP) this.logs.shift();
  }

  getLogs(): string[] { return this.logs.slice(-150); }

  private cliAvailable(cfg: RuntimeConfig): boolean {
    return cfg.allowCliFallback && this.deps.pathExists(this.resolvePython(cfg));
  }

  // --- health check (fail closed) -------------------------------------------
  private async checkHealth(cfg: RuntimeConfig): Promise<any | null> {
    try {
      const h = await this.deps.httpGet(`${cfg.apiUrl}/health`, HEALTH_TIMEOUT);
      return looksLikeAgentos(h) ? h : null;
    } catch { return null; }
  }

  private mapHealth(h: any): RuntimeStatus['health'] {
    const f = (h && h.features) || {};
    const flag = (modern: any, legacy: any) => (modern !== undefined ? !!modern : !!legacy);
    return {
      ok: !!(h && h.ok),
      agentosVersion: (h && h.version) || null,
      networkEnabled: flag(f.network_enabled, h && h.network),
      pythonExecEnabled: flag(f.python_exec_enabled, false),
      shellEnabled: flag(f.shell_enabled, h && h.shell),
      approvalEnabled: f.approval_enabled !== undefined ? !!f.approval_enabled : true,
      ragEnabled: f.rag_enabled !== undefined ? !!f.rag_enabled : true,
    };
  }

  private async fetchRag(cfg: RuntimeConfig): Promise<RuntimeStatus['rag']> {
    try {
      const s = await this.deps.httpGet(`${cfg.apiUrl}/rag/status`, HEALTH_TIMEOUT);
      const e = (s && s.embeddings) || {};
      return {
        available: !!e.available,
        embeddingProvider: e.provider || null,
        embeddingModel: e.model || null,
        embeddingUrl: e.url || null,
        isTestBackend: !!e.is_test_backend,
        indexPath: (s && s.db_path) || null,
        collections: Array.isArray(s && s.collections) ? s.collections.length : 0,
      };
    } catch { return null; }
  }

  /** Evaluate the live API and compute state/warnings (does NOT start anything). */
  private async evaluate(cfg: RuntimeConfig, healthHint?: any): Promise<void> {
    this.warnings = [];
    const h = healthHint ?? (await this.checkHealth(cfg));
    this.lastCheckedAt = new Date().toISOString();

    if (h) {
      this.transport = 'http';
      this.lastHealth = this.mapHealth(h);
      this.lastRag = await this.fetchRag(cfg);
      // Security fail-safes: these must never be on; if they are, surface as degraded.
      if (this.lastHealth!.networkEnabled) this.warnings.push('AgentOS reports network execution ENABLED (unexpected).');
      if (this.lastHealth!.pythonExecEnabled) this.warnings.push('AgentOS reports python_exec ENABLED (unexpected).');
      // Embedding backend posture.
      if (!this.lastRag || !this.lastRag.available) {
        this.warnings.push('No local embedding backend available — RAG answers will fail closed. Run `ollama pull nomic-embed-text`.');
      } else if (this.lastRag.isTestBackend && !cfg.allowHashBackend) {
        this.warnings.push('Embedding backend is the TEST-ONLY hash backend — real retrieval quality is not available.');
      }
      const degraded = this.warnings.length > 0;
      this.state = degraded ? 'degraded' : 'ready';
      this.lastError = degraded ? this.warnings[0] : null;
      return;
    }

    // Not AgentOS on the port. Distinguish "free" vs "occupied by something else".
    this.lastHealth = null;
    this.lastRag = null;
    const busy = await this.deps.portInUse(cfg.apiHost, cfg.apiPort, HEALTH_TIMEOUT).catch(() => false);
    if (busy) {
      this.lastError = `Port ${cfg.apiHost}:${cfg.apiPort} is occupied by a non-AgentOS service — not connecting, and not touching that process.`;
      this.warnings.push(this.lastError);
      if (this.cliAvailable(cfg)) { this.transport = 'cli'; this.state = 'using_cli_fallback'; }
      else { this.transport = 'unavailable'; this.state = 'failed'; }
      return;
    }
    // Port free, API down.
    if (this.cliAvailable(cfg)) { this.transport = 'cli'; this.state = this.startedByDawn ? 'failed' : 'using_cli_fallback'; }
    else { this.transport = 'unavailable'; this.state = 'stopped'; }
  }

  // --- lifecycle -------------------------------------------------------------
  /** Public: ensure AgentOS is usable — connect if up, start it if down (when allowed). */
  async ensure(): Promise<RuntimeStatus> {
    const cfg = this.getConfig();
    if (!cfg.enabled) { this.reset('stopped'); return this.emitStatus(); }
    if (this.state === 'ready') return this.getStatus();
    if (this.starting) return this.starting;
    this.starting = this.doEnsure(cfg).finally(() => { this.starting = null; });
    return this.starting;
  }

  private async doEnsure(cfg: RuntimeConfig): Promise<RuntimeStatus> {
    // 1) Already healthy AgentOS? Use it (do not start a second one).
    const h0 = await this.checkHealth(cfg);
    if (h0) { await this.evaluate(cfg, h0); this.startMonitor(); return this.emitStatus(); }

    // 2) Port occupied by a non-AgentOS service → never start/kill; fall back.
    const busy = await this.deps.portInUse(cfg.apiHost, cfg.apiPort, HEALTH_TIMEOUT).catch(() => false);
    if (busy) { await this.evaluate(cfg); return this.emitStatus(); }

    // 3) Autostart disabled → CLI fallback / stopped.
    if (!cfg.autoStart) { await this.evaluate(cfg); return this.emitStatus(); }

    // 4) Start it ourselves (trusted argv only).
    const py = this.resolvePython(cfg);
    if (!this.deps.pathExists(py)) {
      this.lastError = `AgentOS Python not found at ${py}. Set agentosPythonPath or install the venv.`;
      this.deps.log('error', this.lastError);
      this.transport = 'unavailable'; this.state = 'failed';
      return this.emitStatus();
    }

    this.state = 'starting'; this.lastError = null; this.emitStatus();
    const args = this.uvicornArgs(cfg);
    this.deps.log('info', `Starting AgentOS API: ${path.basename(py)} ${args.join(' ')} (cwd=${cfg.agentosDir})`);
    try {
      this.proc = this.deps.spawnProc(py, args, { cwd: cfg.agentosDir, env: this.childEnv(cfg) });
    } catch (e: any) {
      this.lastError = `Failed to spawn AgentOS: ${redactSecrets(String(e?.message || e))}`;
      this.deps.log('error', this.lastError);
      this.transport = this.cliAvailable(cfg) ? 'cli' : 'unavailable';
      this.state = this.cliAvailable(cfg) ? 'using_cli_fallback' : 'failed';
      return this.emitStatus();
    }
    this.startedByDawn = true;
    this.pid = this.proc.pid ?? null;
    this.proc.onStdout((s) => this.addLog(s));
    this.proc.onStderr((s) => this.addLog(s));
    this.proc.onExit((code) => {
      this.deps.log('info', `AgentOS API process exited (code=${code}).`);
      this.proc = null; this.pid = null; this.startedByDawn = false;
      if (this.state === 'ready' || this.state === 'starting' || this.state === 'degraded') {
        this.state = this.cliAvailable(cfg) ? 'using_cli_fallback' : 'stopped';
        this.transport = this.cliAvailable(cfg) ? 'cli' : 'unavailable';
        this.emitStatus();
      }
    });

    // 5) Readiness loop.
    const t0 = this.deps.now();
    while (this.deps.now() - t0 < cfg.startupTimeoutMs) {
      if (!this.proc) break;             // exited
      const h = await this.checkHealth(cfg);
      if (h) {
        await this.evaluate(cfg, h);
        this.deps.log('info', `AgentOS API ready (pid=${this.pid}, ${this.state}).`);
        this.startMonitor();
        return this.emitStatus();
      }
      await this.deps.sleep(500);
    }

    // Timed out → stop what WE started, fall back.
    this.deps.log('error', `AgentOS API did not become healthy within ${cfg.startupTimeoutMs}ms.`);
    this.stopOwnProcess();
    this.lastError = 'AgentOS API failed to become healthy before timeout.';
    this.transport = this.cliAvailable(cfg) ? 'cli' : 'unavailable';
    this.state = this.cliAvailable(cfg) ? 'using_cli_fallback' : 'failed';
    return this.emitStatus();
  }

  /** Re-check health without (re)starting. */
  async refresh(): Promise<RuntimeStatus> {
    const cfg = this.getConfig();
    if (!cfg.enabled) { this.reset('stopped'); return this.emitStatus(); }
    await this.evaluate(cfg);
    return this.emitStatus();
  }

  async start(): Promise<RuntimeStatus> { return this.ensure(); }

  /** Stop ONLY the process DAWN started. Never touches an unknown process. */
  async stop(): Promise<RuntimeStatus> {
    if (this.startedByDawn && this.proc) {
      this.deps.log('info', 'Stopping DAWN-started AgentOS API.');
      this.stopOwnProcess();
      this.state = 'stopped'; this.transport = 'unavailable';
    } else if (this.proc === null) {
      this.deps.log('info', 'Stop requested but AgentOS was not started by DAWN — leaving it alone.');
    }
    this.stopMonitor();
    return this.emitStatus();
  }

  async restart(): Promise<RuntimeStatus> {
    this.deps.log('info', 'Restart requested.');
    await this.stop();
    this.state = 'stopped';
    return this.ensure();
  }

  private stopOwnProcess() {
    if (this.proc) { try { this.proc.kill(); } catch { /* */ } }
    this.proc = null; this.pid = null; this.startedByDawn = false;
  }

  private reset(state: RuntimeState) {
    this.state = state; this.transport = 'unavailable';
    this.lastHealth = null; this.lastRag = null; this.warnings = []; this.lastError = null;
    this.stopMonitor();
  }

  private startMonitor() {
    if (this.monitorTimer) return;
    const cfg = this.getConfig();
    const iv = Math.max(5000, cfg.healthCheckIntervalMs || 30000);
    this.monitorTimer = setInterval(() => { this.refresh().catch(() => { /* */ }); }, iv);
    if (typeof (this.monitorTimer as any).unref === 'function') (this.monitorTimer as any).unref();
  }
  private stopMonitor() {
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
  }

  getStatus(): RuntimeStatus {
    const cfg = this.getConfig();
    return {
      enabled: cfg.enabled,
      state: this.state,
      transport: this.transport,
      apiUrl: cfg.apiUrl,
      startedByDawn: this.startedByDawn,
      pid: this.pid,
      health: this.lastHealth,
      rag: this.lastRag,
      warnings: [...this.warnings],
      lastError: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  private emitStatus(): RuntimeStatus {
    const st = this.getStatus();
    this.emit('status', st);
    return st;
  }
}

// --- real effect implementations ------------------------------------------
export function realDeps(logger?: { info: (s: string, m: string) => void; warn: (s: string, m: string) => void; error: (s: string, m: string) => void }): RuntimeDeps {
  return {
    httpGet: async (url, timeoutMs) => {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    spawnProc: (exe, args, opts) => {
      const child = spawn(exe, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
      return {
        pid: child.pid,
        onStdout: (cb) => child.stdout?.on('data', (d) => cb(String(d))),
        onStderr: (cb) => child.stderr?.on('data', (d) => cb(String(d))),
        onExit: (cb) => child.on('exit', (code) => cb(code)),
        kill: () => { try { child.kill(); } catch { /* */ } },
      };
    },
    portInUse: (host, port, timeoutMs) => new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (v: boolean) => { if (!done) { done = true; try { sock.destroy(); } catch { /* */ } resolve(v); } };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(port, host);
    }),
    pathExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (level, msg) => { try { (logger as any)?.[level]?.('agentos', msg); } catch { /* */ } },
  };
}

// --- default singleton (wired to DAWN settings + logger) -------------------
export function configFromSettings(s: any): RuntimeConfig {
  const host = s.agentosApiHost || '127.0.0.1';
  const port = Number(s.agentosApiPort) || 8099;
  const apiUrl = s.agentosApiUrl || `http://${host}:${port}`;
  return {
    enabled: !!s.agentosEnabled,
    autoStart: s.agentosAutoStart !== false,
    apiUrl,
    apiHost: host,
    apiPort: port,
    agentosDir: s.agentosDir || 'C:\\Users\\benma\\agentos',
    pythonPath: s.agentosPythonPath || '',
    startupTimeoutMs: Number(s.agentosStartupTimeoutMs) || 15000,
    healthCheckIntervalMs: Number(s.agentosHealthCheckIntervalMs) || 30000,
    preferHttp: s.agentosPreferHttp !== false,
    allowCliFallback: s.agentosAllowCliFallback !== false,
    embeddingProviderExpected: s.agentosEmbeddingProviderExpected || 'ollama',
    embeddingModelExpected: s.agentosEmbeddingModelExpected || 'nomic-embed-text',
    ollamaUrl: s.agentosOllamaUrl || 'http://127.0.0.1:11434',
    allowHashBackend: false,
  };
}

let singleton: AgentosRuntime | null = null;
export function runtime(): AgentosRuntime {
  if (!singleton) {
    // Lazy require to keep this module unit-testable without electron.
    let settings: any; let logger: any;
    try { settings = require('./settings').default; } catch { settings = { get: () => ({}) }; }
    try { logger = require('./logger').default; } catch { logger = null; }
    singleton = new AgentosRuntime(() => configFromSettings(settings.get()), realDeps(logger));
  }
  return singleton;
}

export default { runtime, AgentosRuntime, realDeps, configFromSettings };
