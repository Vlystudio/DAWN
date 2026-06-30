/**
 * Tests for the DAWN-side AgentOS Runtime Manager (electron/services/agentosRuntime.ts).
 * All effects (http/spawn/port/fs/time) are injected, so no real AgentOS or process is
 * needed. Covers: detect healthy API, safe argv start, malformed health, port occupied by
 * a non-AgentOS service, CLI fallback, degraded (no/test embeddings), no-kill of unknown
 * process, stop-only-DAWN-started, redacted logs, safe defaults.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import {
  AgentosRuntime, configFromSettings, RuntimeConfig, RuntimeDeps, RuntimeChild,
} from '../electron/services/agentosRuntime';
import { DEFAULTS } from '../electron/services/settings';

const HEALTHY = {
  ok: true, service: 'agentos', version: '0.13.0',
  features: {
    network_enabled: false, python_exec_enabled: false, shell_enabled: false,
    rag_enabled: true, approval_enabled: true, domain_packs: 13,
    embeddings_available: true, embeddings_provider: 'ollama:nomic-embed-text', embeddings_is_test_backend: false,
  },
};
const RAG_REAL = {
  db_path: 'C:\\agentos\\rag\\rag.db', collections: ['hive', 'garden'], sources: 5, chunks: 20,
  embeddings: { provider: 'ollama:nomic-embed-text', model: 'nomic-embed-text', url: 'http://127.0.0.1:11434', available: true, is_test_backend: false },
};

function cfg(over: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    enabled: true, autoStart: true, apiUrl: 'http://127.0.0.1:8099', apiHost: '127.0.0.1', apiPort: 8099,
    agentosDir: 'C:\\agentos', pythonPath: '', startupTimeoutMs: 3000, healthCheckIntervalMs: 30000,
    preferHttp: true, allowCliFallback: true, embeddingProviderExpected: 'ollama',
    embeddingModelExpected: 'nomic-embed-text', ollamaUrl: 'http://127.0.0.1:11434', allowHashBackend: false, ...over,
  };
}

interface FakeProc extends RuntimeChild { _kill: number; _emitExit: (code: number | null) => void; }
function makeDeps(over: Partial<RuntimeDeps> & { health?: any; rag?: any; portBusy?: boolean; venv?: boolean } = {}): { deps: RuntimeDeps; spawned: { exe: string; args: string[]; env: NodeJS.ProcessEnv }[]; logs: string[]; lastProc: () => FakeProc | null } {
  const spawned: { exe: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const logs: string[] = [];
  let lastProc: FakeProc | null = null;
  const deps: RuntimeDeps = {
    httpGet: over.httpGet || (async (url: string) => {
      if (/\/health$/.test(url)) { if (over.health === undefined) throw new Error('refused'); return over.health; }
      if (/\/rag\/status$/.test(url)) { if (over.rag === undefined) throw new Error('refused'); return over.rag; }
      throw new Error('unknown url');
    }),
    spawnProc: over.spawnProc || ((exe, args, opts) => {
      spawned.push({ exe, args, env: opts.env });
      let exitCb: (c: number | null) => void = () => {};
      lastProc = {
        pid: 4242, _kill: 0, onStdout: () => {}, onStderr: () => {}, onExit: (cb) => { exitCb = cb; },
        kill: () => { lastProc!._kill++; }, _emitExit: (c) => exitCb(c),
      };
      return lastProc;
    }),
    portInUse: over.portInUse || (async () => !!over.portBusy),
    pathExists: over.pathExists || (() => over.venv !== false),
    now: over.now || (() => Date.now()),
    sleep: over.sleep || (async () => {}),
    log: over.log || ((lvl, m) => logs.push(`${lvl}:${m}`)),
  };
  return { deps, spawned, logs, lastProc: () => lastProc };
}

// --- settings defaults are safe -------------------------------------------
test('settings defaults are safe + local', () => {
  const c = configFromSettings(DEFAULTS);
  assert.equal(c.enabled, true);
  assert.equal(c.autoStart, true);
  assert.equal(c.apiHost, '127.0.0.1');
  assert.equal(c.apiPort, 8099);
  assert.equal(c.embeddingProviderExpected, 'ollama');
  assert.equal(c.embeddingModelExpected, 'nomic-embed-text');
  assert.equal(c.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(c.allowHashBackend, false);   // never enable the test backend by default
});

// --- detect an already-healthy API (do not start a second one) ------------
test('detects healthy API and uses HTTP without starting a process', async () => {
  const { deps, spawned } = makeDeps({ health: HEALTHY, rag: RAG_REAL });
  const rt = new AgentosRuntime(() => cfg(), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'ready');
  assert.equal(st.transport, 'http');
  assert.equal(st.startedByDawn, false);
  assert.equal(spawned.length, 0);            // never spawned — reused the running API
  assert.equal(st.health!.networkEnabled, false);
  assert.equal(st.health!.pythonExecEnabled, false);
  assert.equal(st.rag!.embeddingProvider, 'ollama:nomic-embed-text');
  assert.equal(st.rag!.isTestBackend, false);
});

// --- start the API with a safe argv array ---------------------------------
test('starts API with spawn ARGV array (no shell, trusted command)', async () => {
  let calls = 0;
  const m = makeDeps({ rag: RAG_REAL });
  // health: refuse until after spawn, then healthy
  m.deps.httpGet = async (url: string) => {
    if (/\/health$/.test(url)) { calls++; if (calls < 2) throw new Error('down'); return HEALTHY; }
    if (/\/rag\/status$/.test(url)) return RAG_REAL;
    throw new Error('x');
  };
  const rt = new AgentosRuntime(() => cfg(), m.deps);
  const st = await rt.ensure();
  assert.equal(m.spawned.length, 1);
  const { exe, args } = m.spawned[0];
  assert.match(exe, /python\.exe$/);
  assert.deepEqual(args, ['-m', 'uvicorn', 'agentos.ui.api:app', '--host', '127.0.0.1', '--port', '8099', '--log-level', 'warning']);
  assert.equal(st.state, 'ready');
  assert.equal(st.startedByDawn, true);
  assert.equal(st.pid, 4242);
});

test('child env sets local embedding vars + strips cloud keys + never enables hash backend', async () => {
  const m = makeDeps({ rag: RAG_REAL });
  let calls = 0;
  m.deps.httpGet = async (url: string) => { if (/\/health$/.test(url)) { calls++; return calls < 2 ? Promise.reject(new Error('down')) : HEALTHY; } return RAG_REAL; };
  process.env.OPENAI_API_KEY = 'sk-proj-SHOULD_NOT_LEAK_0123456789';
  process.env.AGENTOS_RAG_ALLOW_HASH_EMBEDDINGS = '1';
  const rt = new AgentosRuntime(() => cfg(), m.deps);
  await rt.ensure();
  const env = m.spawned[0].env;
  assert.equal(env.AGENTOS_RAG_EMBEDDING_PROVIDER, 'ollama');
  assert.equal(env.AGENTOS_RAG_EMBEDDING_MODEL, 'nomic-embed-text');
  assert.equal(env.AGENTOS_RAG_OLLAMA_URL, 'http://127.0.0.1:11434');
  assert.equal(env.OPENAI_API_KEY, undefined);                     // cloud key stripped
  assert.equal(env.AGENTOS_RAG_ALLOW_HASH_EMBEDDINGS, undefined);  // test backend not enabled
  delete process.env.OPENAI_API_KEY; delete process.env.AGENTOS_RAG_ALLOW_HASH_EMBEDDINGS;
});

// --- malformed / non-AgentOS health is rejected ---------------------------
test('malformed health response fails closed (not treated as AgentOS)', async () => {
  const { deps, spawned } = makeDeps({ health: { hello: 'world' }, portBusy: true });
  const rt = new AgentosRuntime(() => cfg({ autoStart: false }), deps);
  const st = await rt.ensure();
  assert.notEqual(st.state, 'ready');
  assert.equal(st.health, null);
  assert.equal(spawned.length, 0);
});

// --- port occupied by a non-AgentOS service: do not connect, do not kill ---
test('port occupied by non-AgentOS service -> CLI fallback, never spawns or kills', async () => {
  const { deps, spawned } = makeDeps({ health: undefined, portBusy: true, venv: true });
  const rt = new AgentosRuntime(() => cfg(), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'using_cli_fallback');
  assert.equal(st.transport, 'cli');
  assert.equal(spawned.length, 0);                  // never started a competing server
  assert.match(st.lastError || '', /non-AgentOS/);
  // stop() must not kill anything (we didn't start it)
  const after = await rt.stop();
  assert.equal(after.startedByDawn, false);
});

// --- startup failure -> CLI fallback --------------------------------------
test('startup timeout falls back to CLI and stops the process DAWN started', async () => {
  const m = makeDeps({ venv: true });   // health always refuses -> never ready
  let now = 0;
  m.deps.now = () => now;
  m.deps.sleep = async () => { now += 1000; };       // advance virtual time each poll
  const rt = new AgentosRuntime(() => cfg({ startupTimeoutMs: 2000 }), m.deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'using_cli_fallback');
  assert.equal(st.transport, 'cli');
  assert.equal(m.lastProc()!._kill, 1);              // we killed the proc WE started
  assert.equal(st.startedByDawn, false);
});

test('startup failure with no venv -> failed (no CLI fallback)', async () => {
  const m = makeDeps({ venv: false, portBusy: false });
  const rt = new AgentosRuntime(() => cfg({ autoStart: true }), m.deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'failed');
  assert.equal(st.transport, 'unavailable');
  assert.equal(m.spawned.length, 0);                 // can't spawn without python
});

// --- degraded: embeddings unavailable / test backend ----------------------
test('degraded when embeddings unavailable', async () => {
  const rag = { ...RAG_REAL, embeddings: { available: false } };
  const { deps } = makeDeps({ health: HEALTHY, rag });
  const rt = new AgentosRuntime(() => cfg(), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'degraded');
  assert.match(st.warnings.join(' '), /embedding backend available/i);
});

test('degraded + warns when the TEST-ONLY hash backend is active', async () => {
  const health = { ...HEALTHY, features: { ...HEALTHY.features, embeddings_is_test_backend: true } };
  const rag = { ...RAG_REAL, embeddings: { provider: 'hash-test', available: true, is_test_backend: true } };
  const { deps } = makeDeps({ health, rag });
  const rt = new AgentosRuntime(() => cfg(), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'degraded');
  assert.match(st.warnings.join(' '), /TEST-ONLY/);
  assert.equal(st.rag!.isTestBackend, true);
});

test('degraded + warns if AgentOS unexpectedly reports network/python_exec enabled', async () => {
  const health = { ...HEALTHY, features: { ...HEALTHY.features, network_enabled: true, python_exec_enabled: true } };
  const { deps } = makeDeps({ health, rag: RAG_REAL });
  const rt = new AgentosRuntime(() => cfg(), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'degraded');
  assert.match(st.warnings.join(' '), /network execution ENABLED/);
  assert.match(st.warnings.join(' '), /python_exec ENABLED/);
});

// --- stop only stops a DAWN-started process -------------------------------
test('stop() only kills the process DAWN started', async () => {
  // Case A: DAWN started it -> kill.
  const m = makeDeps({ rag: RAG_REAL });
  let calls = 0;
  m.deps.httpGet = async (url: string) => { if (/\/health$/.test(url)) { calls++; return calls < 2 ? Promise.reject(new Error('down')) : HEALTHY; } return RAG_REAL; };
  const rt = new AgentosRuntime(() => cfg(), m.deps);
  await rt.ensure();
  assert.equal(m.lastProc()!._kill, 0);
  await rt.stop();
  assert.equal(m.lastProc()!._kill, 1);

  // Case B: API was already running (not started by DAWN) -> stop kills nothing.
  const m2 = makeDeps({ health: HEALTHY, rag: RAG_REAL });
  const rt2 = new AgentosRuntime(() => cfg(), m2.deps);
  await rt2.ensure();
  const st2 = await rt2.stop();
  assert.equal(st2.startedByDawn, false);
  assert.equal(m2.spawned.length, 0);
});

// --- disabled -> stopped ---------------------------------------------------
test('disabled runtime reports stopped and does nothing', async () => {
  const { deps, spawned } = makeDeps({ health: HEALTHY });
  const rt = new AgentosRuntime(() => cfg({ enabled: false }), deps);
  const st = await rt.ensure();
  assert.equal(st.state, 'stopped');
  assert.equal(st.enabled, false);
  assert.equal(spawned.length, 0);
});

// --- logs are redacted -----------------------------------------------------
test('captured process logs are secret-redacted', async () => {
  const secret = 'sk-test_fake_fake_fake';
  let stdoutCb: (s: string) => void = () => {};
  const m = makeDeps({ rag: RAG_REAL });
  let calls = 0;
  m.deps.httpGet = async (url: string) => { if (/\/health$/.test(url)) { calls++; return calls < 2 ? Promise.reject(new Error('down')) : HEALTHY; } return RAG_REAL; };
  m.deps.spawnProc = (exe, args, opts) => {
    m.spawned.push({ exe, args, env: opts.env });
    return { pid: 1, onStdout: (cb) => { stdoutCb = cb; }, onStderr: () => {}, onExit: () => {}, kill: () => {} };
  };
  const rt = new AgentosRuntime(() => cfg(), m.deps);
  await rt.ensure();
  stdoutCb(`leaking ${secret} now`);
  const logs = rt.getLogs().join('\n');
  assert.ok(!logs.includes(secret));
  assert.match(logs, /\[REDACTED/);
});
