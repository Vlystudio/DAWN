import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { app } from 'electron';
import settings from './settings';
import logger from './logger';
import runtime from './runtime';
import chat, { resolveTool } from './chat';
import { invokeIpc } from '../ipc';
import { PAGE } from './companionPage';
import { BRIDGE } from './companionBridge';
import { ICON_PNG } from './companionIcon';

/**
 * companion.ts — DAWN's phone access. A small local HTTP server (LAN + Tailscale
 * only, never the public internet) that serves a mobile chat page and streams the
 * FULL DAWN brain to your phone: it reuses chat.generate() verbatim by passing an
 * SSE-forwarding shim in place of an Electron WebContents, so memory, knowledge
 * (RAG), Obsidian, Notion, and tools all work exactly as on the desktop.
 *
 * Security: PIN-gated (constant-time compare + login rate-limit), bound so only
 * your LAN and your Tailnet (100.64.0.0/10) can reach it, no cloud, no accounts.
 */

let server: http.Server | null = null;
const tokens = new Set<string>();
const eventClients = new Set<http.ServerResponse>();
let failedLogins: { n: number; until: number } = { n: 0, until: 0 };

/** Push a main→renderer event (chat tokens, runtime state, progress…) to every
 *  connected phone. Called both from the /api/ipc fake-sender and from main.ts. */
export function broadcast(channel: string, payload: any): void {
  if (!eventClients.size) return;
  const line = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const res of eventClients) {
    try { res.write(line); } catch { eventClients.delete(res); }
  }
}

// ---- serving DAWN's real React app (dist) -------------------------------
const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};
function distFile(rel: string): string {
  for (const root of [path.join(app.getAppPath(), 'dist'), path.join(process.cwd(), 'dist')]) {
    const f = path.join(root, rel.replace(/^\/+/, ''));
    if (f.startsWith(root) && fs.existsSync(f)) return f;
  }
  return '';
}
/** dist/index.html with DAWN's bridge + PWA tags + a mobile-drawer stylesheet injected. */
function appHtml(): string {
  const f = distFile('index.html');
  if (!f) return '<h1>DAWN app not built</h1>';
  let html = fs.readFileSync(f, 'utf-8');
  html = html.replace(/\.\/assets\//g, '/assets/'); // make asset paths absolute
  const head = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" href="/icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="DAWN" />
    <meta name="theme-color" content="#0a0a0f" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <style>
      #dawn-hamburger{ display:none; }
      @media (max-width: 820px){
        aside.w-64{ position:fixed; left:0; top:0; bottom:0; z-index:60; height:100%; transform:translateX(-100%); transition:transform .2s ease; box-shadow:0 0 50px #000; }
        body.nav-open aside.w-64{ transform:none; }
        #dawn-hamburger{ display:flex; align-items:center; justify-content:center; position:fixed; top:calc(8px + env(safe-area-inset-top)); left:8px; z-index:70; width:40px; height:40px; border-radius:11px; background:rgba(20,20,29,.92); backdrop-filter:blur(8px); border:1px solid #262635; color:#ffb020; font-size:18px; }
        main{ padding-top:calc(52px + env(safe-area-inset-top)); }
      }
    </style>
    <script src="/dawn-bridge.js"></script>
  `;
  return html.replace('</head>', head + '</head>');
}

// ---- helpers ---------------------------------------------------------------

function ensurePin(): string {
  const s = settings.get();
  if (s.companionPin && /^\d{4,8}$/.test(s.companionPin)) return s.companionPin;
  const pin = String(crypto.randomInt(100000, 999999)); // 6 digits
  settings.save({ companionPin: pin });
  return pin;
}

function ctEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function tokenOf(req: http.IncomingMessage): string {
  const h = (req.headers['x-dawn-token'] as string) || '';
  if (h) return h;
  const url = new URL(req.url || '/', 'http://x');
  return url.searchParams.get('t') || '';
}
function authed(req: http.IncomingMessage): boolean {
  return tokens.has(tokenOf(req));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy(); // 1MB cap
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: http.ServerResponse, code: number, obj: any) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Classify the machine's IPv4 addresses into LAN + Tailscale (CGNAT 100.64/10). */
export function addresses(): { lan: string[]; tailscale: string } {
  const ifaces = os.networkInterfaces();
  const lan: string[] = [];
  let tailscale = '';
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const ip = ni.address;
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || /tailscale/i.test(name)) tailscale = ip;
      else if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) lan.push(ip);
    }
  }
  return { lan, tailscale };
}

export function status() {
  const s = settings.get();
  const { lan, tailscale } = addresses();
  const port = s.companionPort || 8765;
  const urls: string[] = [];
  for (const ip of lan) urls.push(`http://${ip}:${port}`);
  if (tailscale) urls.push(`http://${tailscale}:${port}`);
  return {
    enabled: !!s.companionEnabled,
    running: !!server,
    port,
    pin: s.companionEnabled ? (s.companionPin || '') : '',
    lan,
    tailscale,
    urls,
  };
}

// ---- SSE bridge: a WebContents look-alike that forwards to the phone --------

function makeSseSender(res: http.ServerResponse): any {
  return {
    send(channel: string, payload: any) {
      try {
        res.write(`event: ${channel}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch { /* client gone */ }
    },
  };
}

// ---- request router --------------------------------------------------------

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;
  const method = req.method || 'GET';

  // Public: login gate at '/', the real DAWN app at '/app', its assets + bridge.
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(PAGE);
  }
  if (method === 'GET' && (p === '/app' || p === '/app/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(appHtml());
  }
  if (method === 'GET' && p === '/dawn-bridge.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    return res.end(BRIDGE);
  }
  if (method === 'GET' && p.startsWith('/assets/')) {
    const f = distFile(p);
    if (!f) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
    return fs.createReadStream(f).pipe(res);
  }
  // App icon (one 256x256 PNG, served at every size iOS/Android asks for; they scale it).
  if (method === 'GET' && /^\/(apple-touch-icon.*\.png|icon(-\d+)?\.png|favicon\.ico)$/.test(p)) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return res.end(ICON_PNG);
  }
  if (method === 'GET' && p === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    return res.end(JSON.stringify({
      name: 'DAWN', short_name: 'DAWN', description: 'Your local AI, on your phone.',
      display: 'standalone', orientation: 'portrait',
      background_color: '#0a0a0f', theme_color: '#0a0a0f', start_url: '/app', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  }
  if (method === 'POST' && p === '/api/login') {
    if (Date.now() < failedLogins.until) return sendJson(res, 429, { error: 'Too many attempts. Wait a moment.' });
    const b = await readBody(req);
    const pin = ensurePin();
    if (b && typeof b.pin === 'string' && ctEqual(b.pin, pin)) {
      failedLogins = { n: 0, until: 0 };
      const token = crypto.randomBytes(24).toString('hex');
      tokens.add(token);
      return sendJson(res, 200, { token, name: 'DAWN' });
    }
    failedLogins.n += 1;
    if (failedLogins.n >= 5) { failedLogins = { n: 0, until: Date.now() + 30_000 }; }
    return sendJson(res, 401, { error: 'Wrong PIN.' });
  }

  // Everything below requires a valid session token.
  if (!authed(req)) return sendJson(res, 401, { error: 'Unauthorized' });

  // Generic IPC bridge: invoke any registered channel (full app parity).
  if (method === 'POST' && p === '/api/ipc') {
    const b = await readBody(req);
    if (!b || typeof b.channel !== 'string') return sendJson(res, 400, { error: 'bad request' });
    try {
      const fakeEvent = { sender: { send: (ch: string, payload: any) => broadcast(ch, payload) } };
      let result = invokeIpc(b.channel, fakeEvent, Array.isArray(b.args) ? b.args : []);
      if (result && typeof result.then === 'function') result = await result;
      if (ArrayBuffer.isView(result) || Buffer.isBuffer(result)) result = null; // don't JSON-bloat binary (e.g. voice synth)
      return sendJson(res, 200, { result });
    } catch (e: any) {
      return sendJson(res, 500, { error: e?.message || 'ipc error' });
    }
  }
  // Server-sent events: main→renderer pushes (chat tokens, status, progress…).
  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    eventClients.add(res);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* */ } }, 25000);
    req.on('close', () => { clearInterval(hb); eventClients.delete(res); });
    return;
  }

  if (method === 'GET' && p === '/api/info') {
    const rs: any = runtime.getStatus();
    const model = (rs.model || '').replace(/\\/g, '/').split('/').pop() || '';
    return sendJson(res, 200, { name: 'DAWN', ready: runtime.isReady(), state: rs.state, model, toolsAllowed: !!settings.get().companionAllowTools });
  }
  if (method === 'POST' && p === '/api/power') {
    const b = await readBody(req);
    if (b && b.on === false) { runtime.stop(); return sendJson(res, 200, { ok: true, state: 'OFF' }); }
    const r = await runtime.start();
    const rs: any = runtime.getStatus();
    return sendJson(res, r.ok ? 200 : 500, { ok: r.ok, error: r.error, state: rs.state });
  }
  if (method === 'GET' && p === '/api/conversations') {
    return sendJson(res, 200, chat.listConversations());
  }
  if (method === 'POST' && p === '/api/conversations') {
    const b = await readBody(req);
    return sendJson(res, 200, chat.createConversation({ title: b.title || 'New chat' }));
  }
  const mMsgs = p.match(/^\/api\/conversations\/([\w-]+)\/messages$/);
  if (method === 'GET' && mMsgs) {
    return sendJson(res, 200, chat.getMessages(mMsgs[1]));
  }
  const mDel = p.match(/^\/api\/conversations\/([\w-]+)$/);
  if (method === 'DELETE' && mDel) {
    chat.deleteConversation(mDel[1]);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/stop') {
    const b = await readBody(req);
    chat.stop(b.conversationId);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/tool-approve') {
    const b = await readBody(req);
    resolveTool(b.callId, !!b.approved);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/chat') {
    const b = await readBody(req);
    let convId = b.conversationId;
    if (!convId) convId = (chat.createConversation({ title: 'New chat' }) as any).id;
    const content = String(b.content || '').trim();
    if (content) chat.addMessage(convId, 'user', content);
    // Open the SSE stream and drive the real pipeline through the shim.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: open\ndata: ${JSON.stringify({ conversationId: convId })}\n\n`);
    const sender = makeSseSender(res);
    try {
      await chat.generate(sender, convId);
    } catch (e: any) {
      sender.send('chat:error', { conversationId: convId, error: e?.message || 'generation failed' });
    }
    try { res.write('event: end\ndata: {}\n\n'); res.end(); } catch { /* */ }
    return;
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---- lifecycle -------------------------------------------------------------

export function start(): { ok: boolean; error?: string } {
  if (server) return { ok: true };
  const s = settings.get();
  if (!s.companionEnabled) return { ok: false, error: 'Phone access is disabled.' };
  ensurePin();
  const port = s.companionPort || 8765;
  try {
    server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        try { sendJson(res, 500, { error: e?.message || 'server error' }); } catch { /* */ }
      });
    });
    server.on('error', (e: any) => {
      logger.error('companion', `server error: ${e.message}`);
      server = null;
    });
    server.listen(port, '0.0.0.0', () => {
      const { lan, tailscale } = addresses();
      logger.info('companion', `Phone access on http://${lan[0] || '0.0.0.0'}:${port}${tailscale ? ` (Tailscale ${tailscale}:${port})` : ''}`);
    });
    return { ok: true };
  } catch (e: any) {
    logger.error('companion', e.message);
    server = null;
    return { ok: false, error: e.message };
  }
}

export function stop(): void {
  tokens.clear();
  for (const res of eventClients) { try { res.end(); } catch { /* */ } }
  eventClients.clear();
  if (server) {
    try { server.close(); } catch { /* */ }
    server = null;
    logger.info('companion', 'Phone access stopped.');
  }
}

/** Apply the current settings: start if enabled, stop if not, restart on change. */
export function apply(): { ok: boolean; error?: string } {
  const s = settings.get();
  stop();
  if (s.companionEnabled) return start();
  return { ok: true };
}

/** Generate a fresh PIN and invalidate existing phone sessions. */
export function regeneratePin(): string {
  tokens.clear();
  const pin = String(crypto.randomInt(100000, 999999));
  settings.save({ companionPin: pin });
  return pin;
}

/**
 * Add a Windows Firewall inbound rule (elevated) for the companion port, scoped
 * to the LAN and the Tailnet (100.64.0.0/10) ONLY — never the public internet.
 * Runs a temp .ps1 via UAC to avoid quoting issues.
 */
export function allowFirewall(): Promise<{ ok: boolean; error?: string }> {
  const port = settings.get().companionPort || 8765;
  const script = [
    '$ErrorActionPreference="SilentlyContinue"',
    'Remove-NetFirewallRule -DisplayName "DAWN Phone Access"',
    `New-NetFirewallRule -DisplayName "DAWN Phone Access" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet,100.64.0.0/10 -Profile Any`,
  ].join('\r\n');
  const file = path.join(app.getPath('temp'), 'dawn-firewall.ps1');
  try { fs.writeFileSync(file, script, 'utf8'); } catch (e: any) { return Promise.resolve({ ok: false, error: e.message }); }
  return new Promise((resolve) => {
    try {
      const child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${file}"'`,
      ], { windowsHide: true });
      child.on('exit', (code) => resolve({ ok: code === 0 }));
      child.on('error', (e) => resolve({ ok: false, error: e.message }));
    } catch (e: any) {
      resolve({ ok: false, error: e.message });
    }
  });
}

export default { start, stop, apply, status, addresses, regeneratePin, allowFirewall, broadcast };
