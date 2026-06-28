import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { net, shell } from 'electron';
import db from './db';
import logger from './logger';
import embeddings from './embeddings';
import settings from './settings';

/**
 * notion.ts — Notion integration (mirrors the Obsidian vault). Reads the pages
 * you share with a Notion integration via the official API (Electron `net`, so
 * it honours the Windows cert store / corporate proxy), extracts plain text, and
 * indexes it LOCALLY into notion_chunks for chat retrieval + the brain. DAWN
 * only ever READS from Notion; your local chats/files are never uploaded.
 */

const NOTION_VERSION = '2022-06-28';
const newId = () => crypto.randomUUID();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

interface ApiResult { ok: boolean; status: number; json: any }

function api(method: string, pathOrUrl: string, body?: any): Promise<ApiResult> {
  return new Promise((resolve) => {
    const token = settings.get().notionToken;
    if (!token) return resolve({ ok: false, status: 0, json: { message: 'No Notion token set.' } });
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.notion.com/v1${pathOrUrl}`;
    let req: any;
    try { req = net.request({ method, url }); } catch (e: any) { return resolve({ ok: false, status: 0, json: { message: e.message } }); }
    req.setHeader('Authorization', `Bearer ${token}`);
    req.setHeader('Notion-Version', NOTION_VERSION);
    req.setHeader('Content-Type', 'application/json');
    let data = '';
    req.on('response', (res: any) => {
      res.on('data', (c: Buffer) => { data += c; });
      res.on('end', () => {
        let json: any = null;
        try { json = JSON.parse(data); } catch { /* */ }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
      });
    });
    req.on('error', (e: any) => resolve({ ok: false, status: 0, json: { message: e.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const richText = (rt: any[]): string => (rt || []).map((t) => t.plain_text || '').join('');

function blockText(b: any): string {
  const t = b.type;
  const d = b[t] || {};
  if (t === 'bulleted_list_item' || t === 'numbered_list_item') return '• ' + richText(d.rich_text);
  if (t === 'to_do') return (d.checked ? '[x] ' : '[ ] ') + richText(d.rich_text);
  if (Array.isArray(d.rich_text)) return richText(d.rich_text);
  return '';
}

function pageTitle(page: any): string {
  const props = page.properties || {};
  for (const k of Object.keys(props)) {
    if (props[k]?.type === 'title') {
      const t = richText(props[k].title);
      if (t) return t;
    }
  }
  return 'Untitled';
}

class Notion extends EventEmitter {
  indexing = false;
  current = 0;
  total = 0;

  isConnected(): boolean {
    return !!settings.get().notionToken;
  }

  async test(): Promise<{ ok: boolean; user?: string; error?: string }> {
    const r = await api('GET', '/users/me');
    if (!r.ok) return { ok: false, error: r.json?.message || `HTTP ${r.status}` };
    return { ok: true, user: r.json?.name || r.json?.bot?.owner?.type || 'Notion integration' };
  }

  /** Connect with a token: save it and validate. */
  async connect(token: string): Promise<{ ok: boolean; user?: string; error?: string }> {
    settings.save({ notionToken: (token || '').trim(), notionEnabled: true });
    const t = await this.test();
    if (t.ok) this.sync().catch(() => {}); // first index in the background
    return t;
  }

  private async listPages(): Promise<any[]> {
    const pages: any[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const body: any = { filter: { property: 'object', value: 'page' }, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await api('POST', '/search', body);
      if (!r.ok) throw new Error(r.json?.message || `search HTTP ${r.status}`);
      pages.push(...(r.json.results || []));
      if (!r.json.has_more) break;
      cursor = r.json.next_cursor;
    }
    return pages;
  }

  private async pageText(pageId: string, depth = 0): Promise<string> {
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 30; guard++) {
      const url = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
      const r = await api('GET', url);
      if (!r.ok) break;
      for (const b of r.json.results || []) {
        const txt = blockText(b);
        if (txt) parts.push(txt);
        if (b.has_children && depth < 2) parts.push(await this.pageText(b.id, depth + 1));
      }
      if (!r.json.has_more) break;
      cursor = r.json.next_cursor;
    }
    return parts.join('\n');
  }

  status() {
    const pages = db.get<{ c: number }>('SELECT COUNT(DISTINCT page_id) c FROM notion_chunks')?.c || 0;
    const chunks = db.get<{ c: number }>('SELECT COUNT(*) c FROM notion_chunks')?.c || 0;
    return { connected: this.isConnected(), indexing: this.indexing, current: this.current, total: this.total, pages, chunks };
  }

  /** Pull all shared pages and (re)index them locally. */
  async sync(): Promise<{ ok: boolean; pages: number; chunks: number; error?: string }> {
    if (!this.isConnected()) return { ok: false, pages: 0, chunks: 0, error: 'Not connected.' };
    if (this.indexing) return { ok: false, pages: 0, chunks: 0, error: 'Already syncing.' };
    this.indexing = true;
    let pageCount = 0;
    let chunkCount = 0;
    try {
      const pages = await this.listPages();
      this.total = pages.length;
      this.current = 0;
      logger.step('notion', `Syncing ${pages.length} Notion pages…`);
      db.run('DELETE FROM notion_chunks');
      for (const page of pages) {
        this.current++;
        if (this.current % 3 === 0) this.emit('progress', this.status());
        try {
          const title = pageTitle(page);
          const url = page.url || '';
          const text = await this.pageText(page.id);
          const body = `${title}\n${text}`.trim();
          if (!body) continue;
          const mtime = Date.parse(page.last_edited_time || '') || Date.now();
          let idx = 0;
          for (let i = 0; i < body.length; i += 1200) {
            const content = body.slice(i, i + 1400);
            const vec = await embeddings.embed(`${title} ${content}`);
            db.run(
              'INSERT INTO notion_chunks (id,page_id,title,url,heading,chunk_index,content,mtime,hash,embedding) VALUES (?,?,?,?,?,?,?,?,?,?)',
              [newId(), page.id, title, url, '', idx, content, Math.floor(mtime), sha(content), db.encodeVec(vec)]
            );
            idx++;
            chunkCount++;
          }
          pageCount++;
        } catch (e: any) {
          logger.warn('notion', `Index page failed: ${e.message}`);
        }
      }
      db.saveNow();
      logger.info('notion', `Notion synced: ${pageCount} pages, ${chunkCount} chunks.`);
      return { ok: true, pages: pageCount, chunks: chunkCount };
    } catch (e: any) {
      logger.error('notion', `Sync failed: ${e.message}`);
      return { ok: false, pages: pageCount, chunks: chunkCount, error: e.message };
    } finally {
      this.indexing = false;
      this.emit('progress', this.status());
    }
  }

  /** Hybrid keyword + embedding search over the indexed Notion pages. */
  async search(query: string, topK = 5) {
    if (!this.isConnected()) return [];
    const qv = await embeddings.embed(query);
    const STOP = new Set(['the', 'and', 'for', 'are', 'what', 'who', 'how', 'why', 'when', 'where', 'about', 'with', 'this', 'that', 'have', 'has', 'you', 'your', 'our', 'can', 'tell', 'list', 'give', 'show', 'all', 'any', 'into', 'from']);
    const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w)))];
    const rows = db.all<any>('SELECT page_id, title, url, content, embedding FROM notion_chunks');
    const scored = rows.map((r) => {
      const v = db.decodeVec(r.embedding);
      let score = (v ? embeddings.cosine(qv, v) : 0) * 0.4;
      const title = (r.title || '').toLowerCase();
      const content = (r.content || '').toLowerCase();
      for (const t of terms) {
        if (title.includes(t)) score += 0.5;
        else if (content.includes(t)) score += 0.14;
      }
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter((s) => s.score > 0.06).map(({ r, score }) => ({
      pageId: r.page_id, title: r.title, url: r.url, content: r.content, score: Number(score.toFixed(3)),
    }));
  }

  open(url: string) {
    if (url) shell.openExternal(url);
  }

  disconnect() {
    settings.save({ notionEnabled: false });
  }
}

export default new Notion();
