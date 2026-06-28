import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import logger from './logger';

/**
 * updateServer.ts — a tiny static HTTP server, bound to 127.0.0.1, that serves
 * DAWN's own update artifacts (latest.yml + the NSIS installer) from a local
 * folder. electron-updater points at this, so updates are fully offline: a new
 * build dropped into the feed folder is found by "Check now" and installed in
 * place. Nothing leaves the machine.
 */

let server: http.Server | null = null;
let port = 0;
let servedDir = '';

export function feedUrl(): string {
  return port ? `http://127.0.0.1:${port}` : '';
}

export function hasManifest(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'latest.yml'));
  } catch {
    return false;
  }
}

function findFreePort(start: number): Promise<number> {
  const test = (p: number) =>
    new Promise<boolean>((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
  return (async () => {
    for (let p = start; p < start + 30; p++) if (await test(p)) return p;
    return start;
  })();
}

/** Start (or reuse) the server for `dir`. Returns the base URL. */
export async function start(dir: string): Promise<string> {
  if (server && servedDir === dir) return feedUrl();
  if (server) stop();
  fs.mkdirSync(dir, { recursive: true });
  servedDir = dir;
  port = await findFreePort(8788);
  const root = path.resolve(dir);

  server = http.createServer((req, res) => {
    try {
      const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^[/\\]+/, '');
      const file = path.resolve(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
      const stat = fs.statSync(file);
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let s = m && m[1] ? parseInt(m[1], 10) : 0;
        let e = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (isNaN(s) || s < 0) s = 0;
        if (isNaN(e) || e >= stat.size) e = stat.size - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${s}-${e}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file, { start: s, end: e }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      }
    } catch (e: any) {
      res.writeHead(500);
      res.end(String(e?.message || e));
    }
  });

  await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', () => resolve()));
  logger.info('updater', `Local update feed serving ${dir} at ${feedUrl()}`);
  return feedUrl();
}

export function stop() {
  try { server?.close(); } catch { /* */ }
  server = null;
  port = 0;
  servedDir = '';
}

export default { start, stop, feedUrl, hasManifest };
