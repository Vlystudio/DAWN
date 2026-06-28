import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import initSqlJs from 'sql.js';
import logger from './logger';

/**
 * DAWN database — real SQLite via sql.js (WASM): no native build, one portable
 * file holding everything local (conversations, memories, the brain graph,
 * knowledge, research, logs). Brute-force cosine handles vector search at MVP
 * scale. Persisted to disk with debounced atomic writes.
 */

let SQL: any = null;
let db: any = null;
let dbFile: string | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let dirty = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, title TEXT, model TEXT, system_prompt TEXT,
  use_rag INTEGER DEFAULT 0, use_web INTEGER DEFAULT 0, use_memory INTEGER DEFAULT 1,
  pinned INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT,
  citations TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, type TEXT, content TEXT, source TEXT,
  importance REAL DEFAULT 0.5, confidence REAL DEFAULT 0.8,
  pinned INTEGER DEFAULT 0, last_used_at INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY, memory_id TEXT, node_id TEXT, relationship TEXT, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY, path TEXT UNIQUE, name TEXT, kind TEXT, status TEXT, added_at INTEGER
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY, source_id TEXT, path TEXT, name TEXT, chunk_index INTEGER,
  content TEXT, hash TEXT, embedding BLOB
);

CREATE TABLE IF NOT EXISTS brain_nodes (
  id TEXT PRIMARY KEY, type TEXT, title TEXT, summary TEXT, source_id TEXT,
  created_at INTEGER, updated_at INTEGER, importance REAL, confidence REAL,
  position_x REAL, position_y REAL, position_z REAL, color_group TEXT, metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS brain_edges (
  id TEXT PRIMARY KEY, source_node_id TEXT, target_node_id TEXT,
  relationship_type TEXT, strength REAL, created_at INTEGER, metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, enabled INTEGER DEFAULT 1, description TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY, url TEXT, title TEXT, domain TEXT, reliability REAL, used_at INTEGER, metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS vault_chunks (
  id TEXT PRIMARY KEY, path TEXT, title TEXT, heading TEXT, chunk_index INTEGER,
  content TEXT, mtime INTEGER, hash TEXT, embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_vault_path ON vault_chunks(path);
CREATE TABLE IF NOT EXISTS notion_chunks (
  id TEXT PRIMARY KEY, page_id TEXT, title TEXT, url TEXT, heading TEXT, chunk_index INTEGER,
  content TEXT, mtime INTEGER, hash TEXT, embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_notion_page ON notion_chunks(page_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, source TEXT, message TEXT
);
`;

function locateWasm(): string {
  const dir = path.dirname(require.resolve('sql.js'));
  let wasm = path.join(dir, 'sql-wasm.wasm');
  if (wasm.includes('app.asar') && !wasm.includes('app.asar.unpacked')) {
    wasm = wasm.replace('app.asar', 'app.asar.unpacked');
  }
  return wasm;
}

export async function init(): Promise<void> {
  if (db) return;
  const wasmPath = locateWasm();
  SQL = await initSqlJs({ locateFile: () => wasmPath });
  dbFile = path.join(app.getPath('userData'), 'dawn.db');
  if (fs.existsSync(dbFile)) {
    try {
      db = new SQL.Database(fs.readFileSync(dbFile));
    } catch (e: any) {
      logger.error('db', `Existing DB unreadable, starting fresh: ${e.message}`);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  saveNow();
  logger.info('db', `Database ready at ${dbFile}`);
}

export function run(sql: string, params: any[] = []) {
  db.run(sql, params);
  scheduleSave();
}

export function all<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function get<T = any>(sql: string, params: any[] = []): T | null {
  const rows = all<T>(sql, params);
  return rows.length ? rows[0] : null;
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) saveNow();
  }, 700);
}

export function saveNow() {
  if (!db || !dbFile) return;
  try {
    const data = Buffer.from(db.export());
    const tmp = `${dbFile}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, dbFile);
    dirty = false;
  } catch (e: any) {
    logger.error('db', `Save failed: ${e.message}`);
  }
}

export function encodeVec(arr: number[] | Float32Array): Uint8Array {
  return new Uint8Array(Float32Array.from(arr).buffer);
}
export function decodeVec(u8: Uint8Array): Float32Array | null {
  if (!u8 || !u8.byteLength) return null;
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return new Float32Array(buf);
}

export function dbPath() {
  return dbFile;
}

export default { init, run, all, get, saveNow, encodeVec, decodeVec, dbPath };
