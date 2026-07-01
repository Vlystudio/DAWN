import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import db from './db';
import settings from './settings';
import logger from './logger';
import embeddings from './embeddings';
import hybridCore from './rag/hybridRetrievalCore';
import rerankerCore from './rag/rerankerCore';
import reranker from './rag/reranker';
import queryExpansion from './rag/queryExpansion';
import parsers from './parsers';
import safety from './safety';
import guard from './knowledge/knowledgeGuardCore';
import sourceState from './knowledge/sourceStateCore';
import citationCore from './knowledge/citationCore';
import stale_ from './knowledge/knowledgeStaleCore';
import live from './workspace/liveHooks';
import { chunkText } from './chunk';
import chunkingCore from './knowledge/chunkingCore';

/**
 * rag.ts — local knowledge / retrieval. Indexes ONLY user-approved folders,
 * skipping sensitive/system paths. Stores chunks + local embeddings in SQLite;
 * retrieval is brute-force cosine. Fully local — no cloud embeddings.
 */

const newId = () => crypto.randomUUID();
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

class Rag extends EventEmitter {
  indexing = false;
  paused = false;
  current = 0;
  total = 0;
  currentFile = '';
  lastSkips: Record<string, number> = {}; // skip reason → count, from the most recent scan

  private allowedExts(): string[] {
    return Array.from(parsers.TEXT_EXT);
  }

  folders(): string[] {
    return settings.get().indexedFolders || [];
  }

  addFolder(folder: string) {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return { ok: false, error: 'Not a valid folder.' };
    const cur = this.folders();
    if (cur.includes(folder)) return { ok: false, error: 'Folder already added.' };
    settings.save({ indexedFolders: [...cur, folder] });
    logger.info('rag', `Folder approved: ${folder}`);
    return { ok: true };
  }

  removeFolder(folder: string) {
    settings.save({ indexedFolders: this.folders().filter((f) => f !== folder) });
    const files = db.all<{ id: string }>('SELECT id FROM knowledge_sources WHERE path LIKE ?', [folder + '%']);
    for (const f of files) { db.run('DELETE FROM knowledge_chunks WHERE source_id=?', [f.id]); live.remove('knowledge_source', f.id); }
    db.run('DELETE FROM knowledge_sources WHERE path LIKE ?', [folder + '%']);
    db.saveNow();
    return { ok: true };
  }

  /** Recursively collect indexable files under a folder (safety-filtered). */
  private scan(folder: string): { path: string; name: string; size: number; mtime: number }[] {
    const allowed = this.allowedExts();
    const out: any[] = [];
    const stack = [folder];
    const skip = (reason: string) => { this.lastSkips[reason] = (this.lastSkips[reason] || 0) + 1; };
    this.lastSkips = {};
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const dv = guard.classifyDir(e.name);
          if (dv.blocked || safety.isBlockedDir(e.name)) { skip(dv.reason || 'protected directory'); continue; }
          stack.push(full);
        } else if (e.isFile()) {
          if (safety.isBlockedFile(full, allowed)) { skip('credential/secret/vault/auth file'); continue; }
          let st: fs.Stats;
          try { st = fs.statSync(full); } catch { continue; }
          const v = guard.classifyFile(full, st.size);
          if (!v.index) { skip(v.reason || 'skipped'); continue; }
          out.push({ path: full, name: e.name, size: st.size, mtime: st.mtimeMs });
        }
      }
    }
    return out;
  }

  estimate(folder: string) {
    const files = this.scan(folder);
    const bytes = files.reduce((a, f) => a + f.size, 0);
    return { fileCount: files.length, bytes };
  }

  private emitProgress() {
    this.emit('progress', this.status());
  }

  async indexAll(): Promise<{ ok: boolean }> {
    if (this.indexing) return { ok: false };
    this.indexing = true;
    this.paused = false;
    const s = settings.get();
    try {
      for (const folder of this.folders()) {
        if (this.paused) break;
        const files = this.scan(folder);
        this.total = files.length;
        this.current = 0;
        this.emitProgress();
        logger.step('rag', `Indexing ${folder} (${files.length} files)…`);
        for (const f of files) {
          if (this.paused) break;
          this.current++;
          this.currentFile = f.path;
          this.emitProgress();
          try {
            await this.indexFile(f.path, f.name, f.mtime, s);
          } catch (e: any) {
            logger.error('rag', `Skip ${f.name}: ${e.message}`);
          }
          if (this.current % 10 === 0) db.saveNow();
        }
      }
      db.saveNow();
      logger.step('rag', 'Indexing complete.');
      return { ok: true };
    } finally {
      this.indexing = false;
      this.currentFile = '';
      this.emitProgress();
    }
  }

  private async indexFile(file: string, name: string, mtime: number, s: any) {
    try {
      const text = await parsers.extractText(file);
      if (!text.trim()) return;
      const hash = sha(text);
      const existing = db.get<{ id: string; status: string }>('SELECT id, status FROM knowledge_sources WHERE path=?', [file]);
      if (existing && existing.status === hash) return; // unchanged
      if (existing) {
        db.run('DELETE FROM knowledge_chunks WHERE source_id=?', [existing.id]);
        db.run('DELETE FROM knowledge_sources WHERE id=?', [existing.id]);
      }
      // Chunking v2: heading/title-aware with real metadata (falls back to plain paragraphs on failure).
      let chunks: any[];
      try { chunks = chunkingCore.chunkV2(text, { size: s.chunkSize, overlap: s.chunkOverlap }); }
      catch { chunks = chunkText(text, { size: s.chunkSize, overlap: s.chunkOverlap }).map((t: string, i: number) => ({ text: t, index: i, chunkTitle: '', parentHeading: '', sectionPath: '', startLine: 0, endLine: 0 })); }
      if (!chunks.length) return;
      const sourceId = newId();
      let size = 0; try { size = fs.statSync(file).size; } catch { /* */ }
      const now = Date.now();
      db.run('INSERT INTO knowledge_sources (id,path,name,kind,status,added_at,state,size_bytes,indexed_at,updated_at,src_mtime,chunk_strategy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [sourceId, file, name, 'file', hash, now, 'indexed', size, now, now, mtime || 0, chunkingCore.CHUNK_STRATEGY_VERSION]);
      live.register('knowledge_source', sourceId, name, 'knowledge'); // live workspace registration (name only, no path)
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const vec = await embeddings.embed(c.text);
        db.run('INSERT INTO knowledge_chunks (id,source_id,path,name,chunk_index,content,hash,embedding,chunk_title,parent_heading,section_path,start_line,end_line,chunk_strategy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
          newId(), sourceId, file, name, i, c.text, hash, db.encodeVec(vec),
          c.chunkTitle || null, c.parentHeading || null, c.sectionPath || null, c.startLine || null, c.endLine || null, chunkingCore.CHUNK_STRATEGY_VERSION,
        ]);
      }
    } catch (e: any) {
      // Record a sanitized failure so the user sees it (no path, no secrets, no contents).
      try {
        const now = Date.now();
        const err = sourceState.sanitizeError(e);
        const existing = db.get<{ id: string }>('SELECT id FROM knowledge_sources WHERE path=?', [file]);
        if (existing) db.run('UPDATE knowledge_sources SET state=?, error_message=?, updated_at=? WHERE id=?', ['failed', err, now, existing.id]);
        else db.run('INSERT INTO knowledge_sources (id,path,name,kind,status,added_at,state,error_message,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [newId(), file, name, 'file', '', now, 'failed', err, now]);
      } catch { /* */ }
    }
  }

  pause() {
    this.paused = true;
    this.emitProgress();
    return { ok: true };
  }

  deleteAll() {
    db.run('DELETE FROM knowledge_chunks');
    db.run('DELETE FROM knowledge_sources');
    settings.save({ indexedFolders: [] });
    db.saveNow();
    logger.warn('rag', 'Knowledge base deleted.');
    return { ok: true };
  }

  /**
   * Re-check indexed sources against the filesystem (no content read): mark stale (changed),
   * removed (gone), or skipped (path/type/size now unsafe). Safe to call anytime; idempotent.
   */
  validate(): { checked: number; stale: number; removed: number; skipped: number } {
    let checked = 0, stale = 0, removed = 0, skipped = 0;
    let rows: any[] = [];
    try { rows = db.all<any>("SELECT id,path,name,size_bytes,src_mtime,state FROM knowledge_sources WHERE state IS NULL OR state IN ('indexed','stale')"); } catch { return { checked, stale, removed, skipped }; }
    for (const r of rows) {
      checked++;
      const now = Date.now();
      // Re-apply the safety guard before touching the path (a file may have become unsafe).
      const fv = guard.classifyFile(r.path);
      if (!fv.index && fv.reason && !/unsupported|no file extension/i.test(fv.reason)) {
        db.run('UPDATE knowledge_sources SET state=?, skipped_reason=?, updated_at=? WHERE id=?', ['skipped', fv.reason, now, r.id]); live.remove('knowledge_source', r.id); skipped++; continue;
      }
      let existsNow = false, curMtime: number | null = null, curSize: number | null = null;
      try { const st = fs.statSync(r.path); existsNow = true; curMtime = st.mtimeMs; curSize = st.size; } catch { existsNow = false; }
      const verdict = stale_.classifyStale({ existsNow, currentMtime: curMtime, currentSize: curSize, indexedMtime: r.src_mtime, indexedSize: r.size_bytes });
      if (verdict === 'removed') { db.run('UPDATE knowledge_sources SET state=?, updated_at=? WHERE id=?', ['removed', now, r.id]); live.remove('knowledge_source', r.id); removed++; }
      else if (verdict === 'stale') { db.run('UPDATE knowledge_sources SET state=?, updated_at=? WHERE id=?', ['stale', now, r.id]); stale++; }
      // 'indexed' / 'unknown' → leave as-is (honest; don't fabricate)
    }
    db.saveNow();
    this.emitProgress();
    return { checked, stale, removed, skipped };
  }

  /**
   * Hybrid retrieval: vector (local embeddings, where present) + real BM25 keyword, fused with
   * reciprocal-rank fusion. Only searches SAFE sources (skipped/removed excluded; stale allowed but
   * flagged). Honest mode label (hybrid / vector / keyword / unavailable) — no faked scores.
   */
  async retrieve(query: string, topK?: number) {
    const s = settings.get();
    const k = topK || s.ragTopK || 5;
    // Candidate chunks from safe sources only. Skipped/removed are excluded; stale is kept + flagged.
    const rows = db.all<any>(
      `SELECT c.id, c.path, c.name, c.chunk_index, c.content, c.embedding, ks.state AS src_state
       FROM knowledge_chunks c LEFT JOIN knowledge_sources ks ON ks.id = c.source_id
       WHERE ks.state IS NULL OR ks.state IN ('indexed','stale')`
    );
    if (!rows.length) { this.lastTrace = { retrievalMode: 'unavailable', rewriteMode: 'disabled', hydeMode: 'disabled', rerankMode: 'disabled', variants: [] }; return []; }

    // Local-model retrieval aids (off by default; each degrades honestly to the original query).
    const rw = await queryExpansion.rewrite(query);
    const hy = await queryExpansion.hyde(query);
    const embedText = hy.text ? `${query} ${hy.text}` : query;        // HyDE widens VECTOR recall only
    const keywordQuery = rw.queries.join(' ');                        // rewrite widens KEYWORD recall

    let qv: Float32Array | null = null;
    try { qv = await embeddings.embed(embedText); } catch { qv = null; }
    const byId = new Map<string, any>();
    const cands = rows.map((r) => {
      byId.set(String(r.id), r);
      let vectorScore: number | null = null;
      if (qv && r.embedding) { const v = db.decodeVec(r.embedding); if (v) vectorScore = embeddings.cosine(qv, v); }
      return { id: String(r.id), name: r.name, text: String(r.content || ''), vectorScore, stale: r.src_state === 'stale' };
    });
    const embeddingsAvailable = cands.some((c) => typeof c.vectorScore === 'number');
    const maxCand = Number(s.maxRerankCandidates) > 0 ? Number(s.maxRerankCandidates) : 20;

    // Hybrid retrieval → then an honest rerank stage over the top candidates.
    const { mode, results } = hybridCore.hybridRank(cands, keywordQuery, { topK: Math.max(k, maxCand) });
    const scoreById = new Map(results.map((r) => [r.id, r]));
    const rr = reranker.decide(embeddingsAvailable);
    const reranked = rerankerCore.rerank(
      results.map((r) => ({ id: r.id, hybridScore: r.score, vectorScore: r.vectorScore })), rr.mode, maxCand
    ).slice(0, k);

    this.lastTrace = {
      retrievalMode: mode, rewriteMode: rw.mode, rewriteVariants: rw.variants, hydeMode: hy.mode,
      rerankMode: rr.mode, rerankReason: rr.reason,
    };

    return reranked.map((res) => {
      const meta = scoreById.get(res.id)!;
      const r = byId.get(res.id) || {};
      return {
        name: r.name, path: r.path, chunkIndex: r.chunk_index, content: r.content,
        score: Number((res.finalScore ?? meta.score).toFixed(3)), retrievalMode: mode,
        vectorRank: meta.vectorRank, keywordRank: meta.keywordRank, keywordScore: meta.keywordScore,
        rerankMode: rr.mode, rerankScore: res.rerankScore, stale: meta.stale,
        // Honest citation: chunk-level (we have a chunk index), file name only, page/section NOT faked.
        citation: citationCore.buildCitation({ name: r.name, path: r.path, sourceType: 'file', chunkIndex: r.chunk_index, retrievalMode: mode }),
      };
    });
  }

  /** Last retrieval trace (safe: modes + variant strings only — no paths/chunk text). For debug UI. */
  lastTrace: any = null;
  retrievalTrace() { return this.lastTrace; }

  /** Retrieval mode summary for the Local Knowledge UI / debug (no path/secret leak). */
  retrievalInfo() {
    let total = 0, embedded = 0;
    try { total = db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_chunks')!.c; } catch { /* */ }
    try { embedded = db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_chunks WHERE embedding IS NOT NULL')!.c; } catch { /* */ }
    const mode = total === 0 ? 'unavailable' : embedded > 0 ? 'hybrid' : 'keyword';
    return { mode, totalChunks: total, embeddedChunks: embedded, reason: hybridCore.modeReason(mode as any, embedded, total) };
  }

  /** Chunking-version reindex info (which sources use an old chunking strategy). Safe counts only. */
  reindexInfo() {
    const V = chunkingCore.CHUNK_STRATEGY_VERSION;
    let total = 0, need = 0;
    try { total = db.get<{ c: number }>("SELECT COUNT(*) c FROM knowledge_sources WHERE state IS NULL OR state IN ('indexed','stale')")!.c; } catch { /* */ }
    try { need = db.get<{ c: number }>("SELECT COUNT(*) c FROM knowledge_sources WHERE (chunk_strategy IS NULL OR chunk_strategy!=?) AND (state IS NULL OR state IN ('indexed','stale'))", [V])!.c; } catch { /* */ }
    return { strategyVersion: V, totalSources: total, needReindex: need };
  }

  /**
   * Reindex sources using an old chunking strategy: for each, re-apply the safety guard, then delete +
   * re-index with v2. Sources whose file is gone or now blocked are skipped honestly (old index removed).
   */
  async reindexOutdated() {
    const V = chunkingCore.CHUNK_STRATEGY_VERSION;
    const s = settings.get();
    const safety = require('./safety').default;
    let rows: any[] = [];
    try { rows = db.all("SELECT id,path,name,src_mtime FROM knowledge_sources WHERE (chunk_strategy IS NULL OR chunk_strategy!=?) AND (state IS NULL OR state IN ('indexed','stale'))", [V]); } catch { rows = []; }
    let reindexed = 0, failed = 0, skipped = 0;
    for (const r of rows) {
      try {
        if (!fs.existsSync(r.path) || safety.isBlockedFile(r.path, undefined)) { skipped++; continue; } // guard re-applied
        db.run('DELETE FROM knowledge_chunks WHERE source_id=?', [r.id]);
        db.run('DELETE FROM knowledge_sources WHERE id=?', [r.id]);
        await this.indexFile(r.path, r.name, r.src_mtime || 0, s);
        reindexed++;
      } catch { failed++; }
    }
    return { ok: true, reindexed, failed, skipped };
  }

  status() {
    const files = db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_sources')!.c;
    const chunks = db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_chunks')!.c;
    const folders = this.folders().map((f) => ({
      path: f,
      files: db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_sources WHERE path LIKE ?', [f + '%'])!.c,
    }));
    const embeddedChunks = (() => { try { return db.get<{ c: number }>('SELECT COUNT(*) c FROM knowledge_chunks WHERE embedding IS NOT NULL')!.c; } catch { return 0; } })();
    const embedModel = (() => { try { return settings.get().embedModel || ''; } catch { return ''; } })();
    const states = (() => { try { return sourceState.summarizeStates(db.all<{ state: string }>('SELECT state FROM knowledge_sources').map((r) => r.state)); } catch { return undefined; } })();
    return {
      indexing: this.indexing, paused: this.paused, current: this.current, total: this.total, currentFile: this.currentFile, folders, totals: { files, chunks },
      skipped: this.lastSkips,
      states,
      embedding: { configuredModel: embedModel, embeddedChunks, mode: embeddedChunks > 0 ? 'embeddings' : (chunks > 0 ? 'keyword fallback' : 'none yet') },
    };
  }
}

export default new Rag();
