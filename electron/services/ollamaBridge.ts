import * as http from 'http';
import settings from './settings';
import logger from './logger';
import runtime from './runtime';

/**
 * ollamaBridge.ts — lets DAWN be the AI brain for OTHER local apps that speak the
 * Ollama API (notably D.C.D / Dawn Cyber Defense, whose sentry calls Ollama's
 * /api/chat + /api/tags). DAWN's own model runs on llama.cpp (OpenAI-compatible
 * /v1/chat/completions on 127.0.0.1), so this shim translates Ollama <-> OpenAI,
 * including tool-calling, and auto-loads the model on demand.
 *
 * Bound to 127.0.0.1 only (local inter-app), unauthenticated like Ollama itself.
 * Default port 11435 (Ollama keeps 11434); point D.C.D here via DAWN_OLLAMA.
 */

let server: http.Server | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function modelName(): string {
  const rs: any = runtime.getStatus();
  return (rs.model || 'dawn').replace(/\\/g, '/').split('/').pop() || 'dawn';
}

/** Make sure DAWN's model runtime is loaded (D.C.D may call while DAWN is idle). */
async function ensureModel(maxMs = 60000): Promise<boolean> {
  if (runtime.isReady()) return true;
  try { await runtime.start(); } catch { /* */ }
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (runtime.isReady()) return true;
    await sleep(700);
  }
  return runtime.isReady();
}

function stripThink(s: string): string {
  // qwen3-style chain-of-thought guard (Qwen2.5 doesn't emit it, but be safe).
  return (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Ollama chat history -> OpenAI messages (assistant tool_calls + tool results). */
function toOpenAIMessages(msgs: any[]): any[] {
  const pendingIds: string[] = [];
  const out: any[] = [];
  for (const m of msgs || []) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const tool_calls = m.tool_calls.map((tc: any, j: number) => {
        const id = `call_${out.length}_${j}`;
        pendingIds.push(id);
        const args = tc.function?.arguments;
        return { id, type: 'function', function: { name: tc.function?.name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) } };
      });
      out.push({ role: 'assistant', content: m.content || '', tool_calls });
    } else if (m.role === 'tool') {
      const tool_call_id = pendingIds.shift();
      out.push({ role: 'tool', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''), ...(tool_call_id ? { tool_call_id } : {}), ...(m.tool_name ? { name: m.tool_name } : {}) });
    } else {
      out.push({ role: m.role || 'user', content: m.content || '' });
    }
  }
  return out;
}

/** OpenAI tool_calls (arguments as JSON string) -> Ollama (arguments as object). */
function toOllamaToolCalls(tcs: any): any[] | undefined {
  if (!Array.isArray(tcs) || !tcs.length) return undefined;
  return tcs.map((tc: any) => {
    let args = tc.function?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return { function: { name: tc.function?.name, arguments: args ?? {} } };
  });
}

function sendJson(res: http.ServerResponse, code: number, obj: any) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 4_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const p = (req.url || '/').split('?')[0];
  const method = req.method || 'GET';

  // Root / version probes (Ollama clients check these).
  if (method === 'GET' && (p === '/' || p === '/api/version')) {
    return p === '/' ? (res.writeHead(200, { 'Content-Type': 'text/plain' }), res.end('DAWN AI bridge (Ollama-compatible)')) : sendJson(res, 200, { version: 'dawn-bridge-1' });
  }

  // List models (D.C.D's ai:tags populates its model picker).
  if (method === 'GET' && p === '/api/tags') {
    const name = modelName();
    return sendJson(res, 200, { models: [{ name, model: name, modified_at: new Date().toISOString(), size: 0, digest: 'dawn', details: { family: 'dawn', parameter_size: '', quantization_level: '' } }] });
  }

  // The chat call D.C.D's sentry uses.
  if (method === 'POST' && p === '/api/chat') {
    const b = await readBody(req);
    if (!(await ensureModel())) {
      return sendJson(res, 200, { model: modelName(), created_at: new Date().toISOString(), message: { role: 'assistant', content: 'DAWN is starting its model — please run the sweep again in a few seconds.' }, done: true, done_reason: 'stop' });
    }
    const s = settings.get();
    const oaBody: any = {
      messages: toOpenAIMessages(b.messages || []),
      stream: false,
      temperature: typeof b.options?.temperature === 'number' ? b.options.temperature : 0.4,
      max_tokens: 1024,
    };
    if (Array.isArray(b.tools) && b.tools.length) oaBody.tools = b.tools;
    try {
      const r = await fetch(`${runtime.baseUrl()}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(oaBody), signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { const t = await r.text().catch(() => ''); return sendJson(res, 200, { model: modelName(), message: { role: 'assistant', content: `DAWN model error (HTTP ${r.status}). ${t.slice(0, 200)}` }, done: true }); }
      const j: any = await r.json();
      const m = j.choices?.[0]?.message || {};
      const tool_calls = toOllamaToolCalls(m.tool_calls);
      const message: any = { role: 'assistant', content: stripThink(m.content || '') };
      if (tool_calls) message.tool_calls = tool_calls;
      return sendJson(res, 200, { model: modelName(), created_at: new Date().toISOString(), message, done: true, done_reason: tool_calls ? 'tool_calls' : 'stop' });
    } catch (e: any) {
      return sendJson(res, 200, { model: modelName(), message: { role: 'assistant', content: `Could not reach DAWN's model: ${e?.message || e}` }, done: true });
    }
  }

  // Minimal /api/generate (single-prompt) for other Ollama clients.
  if (method === 'POST' && p === '/api/generate') {
    const b = await readBody(req);
    if (!(await ensureModel())) return sendJson(res, 200, { model: modelName(), response: 'DAWN is starting its model — try again shortly.', done: true });
    try {
      const r = await fetch(`${runtime.baseUrl()}/v1/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...(b.system ? [{ role: 'system', content: b.system }] : []), { role: 'user', content: b.prompt || '' }], stream: false, max_tokens: 1024 }),
        signal: AbortSignal.timeout(120000),
      });
      const j: any = await r.json();
      return sendJson(res, 200, { model: modelName(), created_at: new Date().toISOString(), response: stripThink(j.choices?.[0]?.message?.content || ''), done: true });
    } catch (e: any) {
      return sendJson(res, 200, { model: modelName(), response: `error: ${e?.message || e}`, done: true });
    }
  }

  sendJson(res, 404, { error: 'not found' });
}

export function start(): { ok: boolean; error?: string } {
  if (server) return { ok: true };
  const port = settings.get().aiBridgePort || 11435;
  try {
    server = http.createServer((req, res) => { handle(req, res).catch((e) => { try { sendJson(res, 500, { error: String(e) }); } catch { /* */ } }); });
    server.on('error', (e: any) => { logger.error('aibridge', `server error: ${e.message}`); server = null; });
    server.listen(port, '127.0.0.1', () => logger.info('aibridge', `Ollama-compatible AI bridge on http://127.0.0.1:${port} (for D.C.D)`));
    return { ok: true };
  } catch (e: any) {
    logger.error('aibridge', e.message); server = null; return { ok: false, error: e.message };
  }
}
export function stop(): void {
  if (server) { try { server.close(); } catch { /* */ } server = null; logger.info('aibridge', 'AI bridge stopped.'); }
}
export function apply(): { ok: boolean; error?: string } {
  stop();
  return settings.get().aiBridgeEnabled ? start() : { ok: true };
}
export function status() {
  const s = settings.get();
  return { enabled: !!s.aiBridgeEnabled, running: !!server, port: s.aiBridgePort || 11435, url: `http://127.0.0.1:${s.aiBridgePort || 11435}` };
}

export default { start, stop, apply, status };
