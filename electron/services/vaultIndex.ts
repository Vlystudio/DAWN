import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import db from './db';
import logger from './logger';
import embeddings from './embeddings';
import vault from './vault';

/**
 * vaultIndex.ts — EmbeddingIndex + VaultSearch over the Obsidian vault.
 *
 * Indexes every Markdown note (chunked by heading) with local embeddings into
 * SQLite (vault_chunks). Retrieval is brute-force cosine + keyword fallback,
 * returning citations to the note path and heading. Fully local.
 */

const newId = () => crypto.randomUUID();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const SKIP_DIRS = new Set(['.obsidian', '.trash', 'attachments', '.git', 'node_modules']);

class VaultIndex extends EventEmitter {
  indexing = false;
  current = 0;
  total = 0;

  private walk(dir: string): string[] {
    let out: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) out = out.concat(this.walk(full));
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
    return out;
  }

  /** Split a note into {heading, content} chunks (by ## sections, then size). */
  private chunkNote(text: string): { heading: string; content: string }[] {
    const body = text.replace(/^---[\s\S]*?---\s*/m, ''); // drop frontmatter
    const parts: { heading: string; content: string }[] = [];
    const sections = body.split(/^(#{1,6}\s.+)$/m);
    let heading = '';
    for (const seg of sections) {
      if (/^#{1,6}\s/.test(seg)) {
        heading = seg.replace(/^#{1,6}\s/, '').trim();
      } else {
        const content = seg.trim();
        if (content) {
          for (let i = 0; i < content.length; i += 1200) parts.push({ heading, content: content.slice(i, i + 1400) });
        }
      }
    }
    if (!parts.length && body.trim()) parts.push({ heading: '', content: body.trim().slice(0, 1400) });
    return parts;
  }

  async reindex(): Promise<{ ok: boolean; notes: number; chunks: number }> {
    if (!vault.isConnected()) return { ok: false, notes: 0, chunks: 0 };
    if (this.indexing) return { ok: false, notes: 0, chunks: 0 };
    this.indexing = true;
    db.run('DELETE FROM vault_chunks');
    let notes = 0;
    let chunks = 0;
    try {
      const files = this.walk(vault.vaultPath());
      this.total = files.length;
      this.current = 0;
      logger.step('vault', `Indexing ${files.length} notes…`);
      for (const file of files) {
        this.current++;
        if (this.current % 5 === 0) this.emit('progress', this.status());
        try {
          chunks += await this.indexFile(file);
          notes++;
        } catch (e: any) {
          logger.error('vault', `Index ${path.basename(file)}: ${e.message}`);
        }
      }
      db.saveNow();
      logger.info('vault', `Vault indexed: ${notes} notes, ${chunks} chunks.`);
      return { ok: true, notes, chunks };
    } finally {
      this.indexing = false;
      this.emit('progress', this.status());
    }
  }

  /** Index/update a single note (used incrementally after writes). */
  async indexFile(file: string): Promise<number> {
    const text = fs.readFileSync(file, 'utf-8');
    const title = (text.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, '.md')).trim();
    const mtime = fs.statSync(file).mtimeMs;
    db.run('DELETE FROM vault_chunks WHERE path=?', [file]);
    const parts = this.chunkNote(text);
    for (let i = 0; i < parts.length; i++) {
      const vec = await embeddings.embed(`${title} ${parts[i].heading} ${parts[i].content}`);
      db.run('INSERT INTO vault_chunks (id,path,title,heading,chunk_index,content,mtime,hash,embedding) VALUES (?,?,?,?,?,?,?,?,?)', [
        newId(), file, title, parts[i].heading, i, parts[i].content, Math.floor(mtime), sha(parts[i].content), db.encodeVec(vec),
      ]);
    }
    return parts.length;
  }

  /** Hybrid search: keyword matching (title/heading weighted) + embedding
   *  tiebreaker. Tuned for a personal vault where note titles are meaningful. */
  async search(query: string, topK = 5) {
    if (!vault.isConnected()) return [];
    const qv = await embeddings.embed(query);
    // Drop a few stopwords so "what are my projects" focuses on "projects".
    const STOP = new Set(['the', 'and', 'for', 'are', 'what', 'who', 'how', 'why', 'when', 'where', 'about', 'with', 'this', 'that', 'have', 'has', 'was', 'were', 'you', 'your', 'our', 'can', 'tell', 'list', 'give', 'show', 'all', 'any', 'into', 'from']);
    const terms = [...new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w)))];
    const rows = db.all<any>('SELECT path, title, heading, content, embedding FROM vault_chunks');
    const scored = rows.map((r) => {
      const v = db.decodeVec(r.embedding);
      let score = (v ? embeddings.cosine(qv, v) : 0) * 0.4; // light semantic component
      const title = (r.title || '').toLowerCase();
      const heading = (r.heading || '').toLowerCase();
      const content = (r.content || '').toLowerCase();
      for (const t of terms) {
        if (title.includes(t)) score += 0.5; // strongest: the note is about this
        else if (heading.includes(t)) score += 0.28;
        else if (content.includes(t)) score += 0.14;
      }
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter((s) => s.score > 0.06).map(({ r, score }) => ({
      path: r.path, title: r.title, heading: r.heading, content: r.content, score: Number(score.toFixed(3)),
    }));
  }

  status() {
    const notes = db.get<{ c: number }>('SELECT COUNT(DISTINCT path) c FROM vault_chunks')!.c;
    const chunks = db.get<{ c: number }>('SELECT COUNT(*) c FROM vault_chunks')!.c;
    return { indexing: this.indexing, current: this.current, total: this.total, notes, chunks };
  }
}

export default new VaultIndex();
