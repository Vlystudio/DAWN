import { spawn } from 'child_process';
import { net } from 'electron';
import logger from './logger';

/**
 * tools.ts — DAWN's agentic tools: PowerShell execution and real internet
 * access (search + fetch). Everything here is audit-logged. PowerShell is gated
 * behind explicit user approval in the chat tool-loop (see chat.ts). Web fetch
 * has SSRF protection and treats page text as untrusted data.
 *
 * These are powerful, dual-use capabilities for the user's OWN machine and are
 * OFF by default (enable in Settings → Tools).
 */

// --- PowerShell -------------------------------------------------------------

export interface ShellResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export function runPowerShell(command: string, timeoutMs = 60000): Promise<ShellResult> {
  return new Promise((resolve) => {
    logger.warn('tool', `PowerShell » ${command.slice(0, 200)}`);
    const p = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    const cap = 24000;
    p.stdout.on('data', (d) => { out += d; if (out.length > cap) out = out.slice(0, cap); });
    p.stderr.on('data', (d) => { err += d; if (err.length > cap) err = err.slice(0, cap); });
    const to = setTimeout(() => { try { p.kill(); } catch { /* */ } }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(to);
      logger.info('tool', `PowerShell exit ${code}`);
      resolve({ ok: code === 0, stdout: out.trim(), stderr: err.trim(), code: code ?? -1 });
    });
    p.on('error', (e) => {
      clearTimeout(to);
      resolve({ ok: false, stdout: '', stderr: e.message, code: -1 });
    });
  });
}

// --- Internet ---------------------------------------------------------------

function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '0.0.0.0' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface NetResult { ok: boolean; status?: number; contentType?: string; body?: string; finalUrl?: string; error?: string }

/**
 * netGet — HTTP GET via Electron's `net` (Windows cert store + system proxy), so
 * it works behind corporate proxies where Node's fetch fails. Follows redirects
 * manually and validates each hop against `guard` (SSRF protection).
 */
function netGet(startUrl: string, opts: { headers?: Record<string, string>; guard?: (host: string) => boolean; maxBytes?: number; timeoutMs?: number } = {}): Promise<NetResult> {
  const { headers = {}, guard, maxBytes = 2_000_000, timeoutMs = 20000 } = opts;
  return (async () => {
    let url = startUrl;
    for (let hop = 0; hop < 5; hop++) {
      const result: any = await new Promise((resolve) => {
        let req: any;
        try { req = net.request({ url, redirect: 'manual' }); } catch (e: any) { return resolve({ error: e.message }); }
        for (const k of Object.keys(headers)) req.setHeader(k, headers[k]);
        let data = '';
        let len = 0;
        let settled = false;
        const finish = (r: any) => { if (settled) return; settled = true; clearTimeout(to); resolve(r); };
        const to = setTimeout(() => { try { req.abort(); } catch { /* */ } finish({ error: 'timeout' }); }, timeoutMs);
        req.on('response', (res: any) => {
          const status = res.statusCode;
          const loc = res.headers['location'];
          if (status >= 300 && status < 400 && loc) { try { res.destroy(); } catch { /* */ } return finish({ redirect: Array.isArray(loc) ? loc[0] : loc }); }
          const contentType = String(res.headers['content-type'] || '');
          res.on('data', (c: Buffer) => { if (settled) return; len += c.length; if (len > maxBytes) { try { req.abort(); } catch { /* */ } finish({ status, contentType, body: data }); } else { data += c; } });
          res.on('end', () => finish({ status, contentType, body: data, finalUrl: url }));
          res.on('error', (e: any) => finish({ error: e.message }));
        });
        req.on('error', (e: any) => finish({ error: e.message }));
        req.end();
      });
      if (result.error) return { ok: false, error: result.error };
      if (result.redirect) {
        let next: URL;
        try { next = new URL(result.redirect, url); } catch { return { ok: false, error: 'bad redirect' }; }
        if (!/^https?:$/.test(next.protocol)) return { ok: false, error: 'non-http redirect' };
        if (guard && guard(next.hostname)) return { ok: false, error: 'blocked redirect to private address' };
        url = next.toString();
        continue;
      }
      return { ok: result.status >= 200 && result.status < 300, status: result.status, contentType: result.contentType, body: result.body, finalUrl: result.finalUrl };
    }
    return { ok: false, error: 'too many redirects' };
  })();
}

// A realistic desktop UA — some endpoints reject obvious bot UAs.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** General internet search (Google-style results) via DuckDuckGo, no API key.
 *  Tries the HTML endpoint, then falls back to the Lite endpoint if blocked. */
export async function webSearch(query: string, limit = 6): Promise<SearchResult[]> {
  logger.info('tool', `Web search » ${query}`);
  // Primary: html.duckduckgo.com
  let r = await netGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, guard: isPrivateHost, timeoutMs: 15000,
  });
  let results: SearchResult[] = [];
  if (r.ok && r.body) {
    const html = r.body;
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < limit) {
      let url = decodeURIComponent(m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0]);
      if (url.startsWith('//')) url = 'https:' + url;
      const title = stripTags(m[2]);
      const after = html.slice(m.index, m.index + 1200);
      const sm = after.match(/result__snippet[^>]*>([\s\S]*?)<\/a>/);
      results.push({ title, url, snippet: sm ? stripTags(sm[1]) : '' });
    }
  }
  // Fallback: lite.duckduckgo.com (simpler markup, less likely to be rate-limited)
  if (!results.length) {
    r = await netGet(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, guard: isPrivateHost, timeoutMs: 15000,
    });
    if (r.ok && r.body) {
      const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.body)) && results.length < limit) {
        let url = m[1]; if (url.startsWith('//')) url = 'https:' + url;
        results.push({ title: stripTags(m[2]), url, snippet: '' });
      }
    }
  }
  if (!results.length) logger.warn('tool', `Web search returned nothing (${r.error || r.status})`);
  return results;
}

/** Wikipedia lookup — searches, then returns the top article's factual summary + URL. */
export async function wikipedia(query: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  logger.info('tool', `Wikipedia » ${query}`);
  const s = await netGet(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=4&format=json`, {
    headers: { 'User-Agent': BROWSER_UA }, guard: isPrivateHost, timeoutMs: 12000,
  });
  if (!s.ok || !s.body) return { ok: false, error: `Wikipedia search failed (${s.error || s.status})` };
  let sd: any; try { sd = JSON.parse(s.body); } catch { return { ok: false, error: 'parse error' }; }
  const hits: any[] = sd?.query?.search || [];
  if (!hits.length) return { ok: false, error: `no Wikipedia article for "${query}"` };
  const top = hits[0].title as string;
  const e = await netGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top.replace(/ /g, '_'))}`, {
    headers: { 'User-Agent': BROWSER_UA }, guard: isPrivateHost, timeoutMs: 12000,
  });
  if (e.ok && e.body) {
    try {
      const ed = JSON.parse(e.body);
      const url = ed.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(top.replace(/ /g, '_'))}`;
      const related = hits.slice(1).map((h) => h.title).join(', ');
      return { ok: true, text: `${ed.title}\n${ed.extract || ''}\nSource: ${url}${related ? `\nRelated articles: ${related}` : ''} [source: Wikipedia, live]` };
    } catch { /* fall through */ }
  }
  return { ok: true, text: `${top}\n${stripTags(hits[0].snippet || '')}\nSource: https://en.wikipedia.org/wiki/${encodeURIComponent(top.replace(/ /g, '_'))} [source: Wikipedia]` };
}

/** Recent news via Google News RSS (no key). query optional → top headlines. */
export async function news(query: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  logger.info('tool', `News » ${query || '(top headlines)'}`);
  const url = (query || '').trim()
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`;
  const r = await netGet(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/rss+xml,text/xml' }, guard: isPrivateHost, timeoutMs: 15000 });
  if (!r.ok || !r.body) return { ok: false, error: `news fetch failed (${r.error || r.status})` };
  const items = parseFeed(r.body, 8);
  if (!items.length) return { ok: false, error: 'no news items found' };
  const text = items.map((it, i) => `[${i + 1}] ${it.title}${it.source ? ` — ${it.source}` : ''}${it.date ? ` (${it.date})` : ''}\n${it.link}`).join('\n\n');
  return { ok: true, text: text + '\n[source: Google News, live]' };
}

/**
 * Reddit — browse a subreddit, search, or read a thread's comments. Reddit blocks
 * its unauthenticated `.json` API (HTTP 403) but its RSS/Atom feeds still work, so
 * we use those (no key, no auth).
 */
export async function reddit(opts: { subreddit?: string; query?: string; sort?: string; url?: string }): Promise<{ ok: boolean; text?: string; error?: string }> {
  const { subreddit, query, sort = 'hot', url } = opts || {};
  logger.info('tool', `Reddit » ${JSON.stringify(opts).slice(0, 120)}`);
  let feed = '';
  let mode: 'thread' | 'list' = 'list';
  if (url && /(^|\.)reddit\.com\//.test(url)) {
    feed = url.split('?')[0].replace(/\/+$/, '') + '/.rss';
    mode = 'thread';
  } else if (query) {
    feed = subreddit
      ? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&limit=10`
      : `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=relevance&limit=10`;
  } else if (subreddit) {
    const s = ['hot', 'top', 'new', 'rising'].includes(sort) ? sort : 'hot';
    feed = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${s === 'hot' ? '' : s + '/'}.rss?limit=12`;
  } else {
    return { ok: false, error: 'reddit needs a subreddit, query, or url' };
  }
  const r = await netGet(feed, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/atom+xml,application/rss+xml,text/xml' }, guard: isPrivateHost, timeoutMs: 15000 });
  if (!r.ok || !r.body) return { ok: false, error: `reddit fetch failed (${r.error || r.status}); Reddit may be rate-limiting — try again shortly.` };
  const items = parseFeed(r.body, mode === 'thread' ? 10 : 12);
  if (!items.length) return { ok: false, error: 'no reddit results (subreddit may be private/empty, or rate-limited)' };
  if (mode === 'thread') {
    const text = items.map((it, i) => `[${i + 1}] ${it.author || 'post'}: ${(it.summary || it.title).slice(0, 400)}\n${it.link}`).join('\n\n');
    return { ok: true, text: text + '\n[source: Reddit, live]' };
  }
  const text = items.map((it, i) => `[${i + 1}] ${it.title}${it.author ? ` — by ${it.author}` : ''}\n${it.link}${it.summary ? `\n${it.summary.slice(0, 200)}` : ''}`).join('\n\n');
  return { ok: true, text: text + '\n[source: Reddit, live]' };
}

/** Parse an RSS (<item>) OR Atom (<entry>) feed into normalized items. */
function parseFeed(xml: string, limit: number): { title: string; link: string; date: string; source: string; author: string; summary: string }[] {
  const out: { title: string; link: string; date: string; source: string; author: string; summary: string }[] = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    if (out.length >= limit) break;
    const tag = (t: string) => {
      const m = b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'));
      return m ? stripTags(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')).trim() : '';
    };
    const title = tag('title');
    if (!title) continue;
    // link: RSS = text in <link>; Atom = <link href="...">
    let link = tag('link');
    if (!link) { const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1]; }
    const author = tag('name') || tag('dc:creator') || tag('author');
    const summary = tag('description') || tag('content') || tag('summary');
    out.push({
      title, link, author,
      summary: summary && summary !== title ? summary : '',
      date: (tag('pubDate') || tag('updated') || tag('published')).replace(/T\d{2}:\d{2}.*$/, '').replace(/\s*\d{2}:\d{2}:\d{2}.*$/, ''),
      source: tag('source'),
    });
  }
  return out;
}

/** Fetch a page and return clean readable text (SSRF-guarded, untrusted data). */
export async function webFetch(urlStr: string): Promise<{ ok: boolean; url?: string; title?: string; text?: string; error?: string }> {
  logger.info('tool', `Web fetch » ${urlStr}`);
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return { ok: false, error: 'invalid URL' };
  }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'non-http URL' };
  if (isPrivateHost(u.hostname)) return { ok: false, error: 'blocked local/private address' };
  const r = await netGet(urlStr, {
    headers: { 'User-Agent': 'Mozilla/5.0 (DAWN local assistant)', Accept: 'text/html,application/xhtml+xml,text/plain' },
    guard: isPrivateHost,
    maxBytes: 2_000_000,
    timeoutMs: 20000,
  });
  if (!r.ok) return { ok: false, error: r.error || `HTTP ${r.status}` };
  const ctype = (r.contentType || '').toLowerCase();
  // APIs / plain text: return the raw body so structured data stays accurate.
  if (ctype.includes('json') || (ctype.includes('text') && !ctype.includes('html'))) {
    return { ok: true, url: r.finalUrl || urlStr, title: '', text: (r.body || '').slice(0, 8000) };
  }
  if (!ctype.includes('html')) return { ok: false, error: `unsupported content-type ${ctype}` };
  const { title, text } = extractReadable(r.body || '');
  return { ok: true, url: r.finalUrl || urlStr, title, text: text.slice(0, 6000) };
}

// --- Weather (real, structured data — no guessing) --------------------------

const WMO: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'light rain showers', 81: 'rain showers', 82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};

/** Live current weather via Open-Meteo (free, no key, accurate). */
export async function getWeather(location: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  logger.info('tool', `Weather » ${location}`);
  // Split "City, State/Country" — Open-Meteo geocoding wants the city; we use the
  // rest to disambiguate (e.g. Portland, Maine vs Portland, Oregon).
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  const city = parts[0] || location;
  const hint = parts.slice(1).join(' ').toLowerCase();
  const g = await netGet(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`, { timeoutMs: 12000 });
  if (!g.ok || !g.body) return { ok: false, error: `geocoding failed (${g.error || g.status})` };
  let geo: any; try { geo = JSON.parse(g.body); } catch { return { ok: false, error: 'geocode parse error' }; }
  const results: any[] = geo.results || [];
  if (!results.length) return { ok: false, error: `couldn't find location "${location}"` };
  let loc = results[0];
  if (hint) {
    const match = results.find((r) =>
      String(r.admin1 || '').toLowerCase().includes(hint) ||
      hint.includes(String(r.admin1 || '').toLowerCase()) ||
      String(r.country || '').toLowerCase().includes(hint) ||
      String(r.country_code || '').toLowerCase() === hint
    );
    if (match) loc = match;
  }
  const w = await netGet(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`, { timeoutMs: 12000 });
  if (!w.ok || !w.body) return { ok: false, error: `weather fetch failed (${w.error || w.status})` };
  let wd: any; try { wd = JSON.parse(w.body); } catch { return { ok: false, error: 'weather parse error' }; }
  const c = wd.current;
  if (!c) return { ok: false, error: 'no current data' };
  const place = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');
  const text = `${place}: ${Math.round(c.temperature_2m)}°F (feels like ${Math.round(c.apparent_temperature)}°F), ${WMO[c.weather_code] || 'unknown'}. Humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} mph, precipitation ${c.precipitation} in. [source: Open-Meteo, live]`;
  return { ok: true, text };
}

function stripTags(s: string) {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } });
}
function extractReadable(html: string) {
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : '';
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside', 'svg', 'iframe', 'form'])
    h = h.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  const main = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i);
  let body = main ? main[0] : h;
  body = body.replace(/<\/(p|div|li|h[1-6]|tr|section|br)\s*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/[ \t]+/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
  return { title, text: text.trim() };
}

export default { runPowerShell, webSearch, webFetch, getWeather, wikipedia, news, reddit };
