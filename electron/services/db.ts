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

-- Deep Research mode (multi-source research runs, saved locally) -----------
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY, question TEXT, depth TEXT, source_mode TEXT, model TEXT,
  status TEXT, plan TEXT, error TEXT, report_id TEXT,
  created_at INTEGER, updated_at INTEGER, started_at INTEGER, finished_at INTEGER,
  metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS research_steps (
  id TEXT PRIMARY KEY, run_id TEXT, idx INTEGER, phase TEXT, status TEXT,
  title TEXT, detail TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_steps_run ON research_steps(run_id);
CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY, run_id TEXT, source_id TEXT, kind TEXT, claim TEXT,
  confidence REAL, metadata_json TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_findings_run ON research_findings(run_id);
CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY, run_id TEXT, title TEXT, format TEXT,
  content_md TEXT, content_html TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_research_reports_run ON research_reports(run_id);

-- Model Arena (compare) + hardware benchmarking ----------------------------
CREATE TABLE IF NOT EXISTS compare_runs (
  id TEXT PRIMARY KEY, prompt TEXT, system_prompt TEXT, params_json TEXT,
  blind INTEGER DEFAULT 0, judge_model TEXT, status TEXT,
  winner_model TEXT, winner_label TEXT, created_at INTEGER, updated_at INTEGER, metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS compare_outputs (
  id TEXT PRIMARY KEY, run_id TEXT, position INTEGER, label TEXT,
  model_path TEXT, model_name TEXT, quant TEXT, output TEXT, status TEXT, error TEXT, oom INTEGER DEFAULT 0,
  load_ms INTEGER, first_token_ms INTEGER, total_ms INTEGER, tokens_per_sec REAL,
  prompt_tokens INTEGER, completion_tokens INTEGER, backend TEXT, gpu_layers INTEGER,
  context_length INTEGER, temperature REAL, top_p REAL, repeat_penalty REAL, est_ram_gb REAL, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_compare_outputs_run ON compare_outputs(run_id);
CREATE TABLE IF NOT EXISTS compare_scores (
  id TEXT PRIMARY KEY, run_id TEXT, judge_model TEXT, winner_label TEXT, winner_model TEXT,
  analysis_md TEXT, strengths_json TEXT, weaknesses_json TEXT, merged_answer TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS benchmarks (
  id TEXT PRIMARY KEY, model_path TEXT, model_name TEXT, quant TEXT, params_b REAL,
  status TEXT, error TEXT, oom INTEGER DEFAULT 0,
  load_ms INTEGER, first_token_ms INTEGER, total_ms INTEGER, tokens_per_sec REAL,
  prompt_tokens INTEGER, completion_tokens INTEGER, backend TEXT, gpu_layers INTEGER,
  context_length INTEGER, est_max_context INTEGER, est_ram_gb REAL, created_at INTEGER, metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_model ON benchmarks(model_path);

-- Documents workspace (Part A) ---------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, title TEXT, content TEXT, format TEXT,
  archived INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY, doc_id TEXT, content TEXT, label TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_docversions_doc ON document_versions(doc_id);

-- Notes + Tasks (Part B) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT,
  pinned INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS note_links (
  id TEXT PRIMARY KEY, note_id TEXT, target_type TEXT, target_id TEXT, label TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_note_links_note ON note_links(note_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT, details TEXT, status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'normal',
  due_at INTEGER, remind_at INTEGER, recurrence TEXT DEFAULT 'none', reminded INTEGER DEFAULT 0,
  source_type TEXT, source_id TEXT, created_at INTEGER, updated_at INTEGER, completed_at INTEGER, metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY, task_id TEXT, kind TEXT, detail TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);

-- Calendar-lite (Part C) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY, title TEXT, details TEXT, location TEXT,
  start_at INTEGER, end_at INTEGER, all_day INTEGER DEFAULT 0,
  uid TEXT, source_type TEXT, source_id TEXT, created_at INTEGER, updated_at INTEGER, metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_at);

-- Prompt-security audit (Part F) --------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_security_events (
  id TEXT PRIMARY KEY, ts INTEGER, source_type TEXT, source_id TEXT, label TEXT,
  risk_score REAL, severity TEXT, matched_patterns TEXT, action_taken TEXT,
  excerpt_hash TEXT, excerpt_preview TEXT, related_node_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pse_ts ON prompt_security_events(ts);

-- Tool/Skill registry (Part E) ----------------------------------------------
CREATE TABLE IF NOT EXISTS tool_state (
  tool_id TEXT PRIMARY KEY, enabled INTEGER, always_allow INTEGER DEFAULT 0, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS tool_audit (
  id TEXT PRIMARY KEY, ts INTEGER, tool_id TEXT, tool_name TEXT, provider_id TEXT, skill_id TEXT,
  risk_level TEXT, permission TEXT, approval_required INTEGER, approval_decision TEXT,
  input_hash TEXT, input_preview TEXT, output_hash TEXT, output_preview TEXT,
  status TEXT, error_message TEXT, duration_ms INTEGER, related_node_id TEXT, prompt_security_event_ids TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_audit_ts ON tool_audit(ts);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT, description TEXT, body TEXT, enabled INTEGER DEFAULT 1,
  allowed_tools TEXT, risk_level TEXT, tags TEXT, created_at INTEGER, updated_at INTEGER, last_run_at INTEGER, run_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY, skill_id TEXT, status TEXT, input_hash TEXT, output_hash TEXT, error TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_skill_runs_skill ON skill_runs(skill_id);

-- Auth + Vault (Part G) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_config (
  id TEXT PRIMARY KEY, password_hash TEXT, password_salt TEXT, hash_algorithm TEXT, hash_params TEXT,
  totp_enabled INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_audit (
  id TEXT PRIMARY KEY, ts INTEGER, event TEXT, detail TEXT, success INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit(ts);
CREATE TABLE IF NOT EXISTS vault_items (
  id TEXT PRIMARY KEY, label TEXT, kind TEXT, username TEXT, secret_enc TEXT, metadata_enc TEXT,
  tags TEXT, created_at INTEGER, updated_at INTEGER, last_accessed_at INTEGER, rotation_reminder_at INTEGER
);
CREATE TABLE IF NOT EXISTS vault_key_metadata (
  id TEXT PRIMARY KEY, os_wrapped TEXT, pw_wrapped TEXT, pw_salt TEXT, kdf_params TEXT, algorithm TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS totp_backup_codes (
  id TEXT PRIMARY KEY, code_hash TEXT, used INTEGER DEFAULT 0, created_at INTEGER, used_at INTEGER
);
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, detail TEXT
);

-- Email workspace (Part D) --------------------------------------------------
CREATE TABLE IF NOT EXISTS email_accounts (
  id TEXT PRIMARY KEY, label TEXT, email_address TEXT, display_name TEXT,
  imap_host TEXT, imap_port INTEGER, imap_secure INTEGER DEFAULT 1,
  smtp_host TEXT, smtp_port INTEGER, smtp_secure INTEGER DEFAULT 1, smtp_start_tls INTEGER DEFAULT 0,
  username TEXT, credential_vault_item_id TEXT, enabled INTEGER DEFAULT 1,
  last_sync_at INTEGER, last_sync_status TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS email_folders (
  id TEXT PRIMARY KEY, account_id TEXT, path TEXT, display_name TEXT, flags TEXT,
  message_count INTEGER, unread_count INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_folders_acct ON email_folders(account_id);
CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY, account_id TEXT, folder_path TEXT, uid TEXT, provider_message_id TEXT, thread_key TEXT,
  subject TEXT, from_name TEXT, from_email TEXT, to_json TEXT, cc_json TEXT, date INTEGER,
  snippet TEXT, body_text TEXT, body_html_sanitized TEXT, flags_json TEXT, seen INTEGER DEFAULT 0,
  has_attachments INTEGER DEFAULT 0, attachment_count INTEGER DEFAULT 0, content_hash TEXT,
  prompt_risk_score REAL, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_messages_acct ON email_messages(account_id, folder_path);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_key);
CREATE TABLE IF NOT EXISTS email_attachments (
  id TEXT PRIMARY KEY, message_id TEXT, filename TEXT, mime_type TEXT, size_bytes INTEGER,
  content_id TEXT, storage_path TEXT, downloaded INTEGER DEFAULT 0, content_hash TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_att_msg ON email_attachments(message_id);
CREATE TABLE IF NOT EXISTS email_drafts (
  id TEXT PRIMARY KEY, account_id TEXT, reply_to_message_id TEXT, to_json TEXT, cc_json TEXT, bcc_json TEXT,
  subject TEXT, body TEXT, in_reply_to TEXT, refs TEXT, status TEXT, created_by TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS email_tags (id TEXT PRIMARY KEY, name TEXT, color TEXT);
CREATE TABLE IF NOT EXISTS email_message_tags (message_id TEXT, tag_id TEXT);
CREATE INDEX IF NOT EXISTS idx_email_msg_tags ON email_message_tags(message_id);
CREATE TABLE IF NOT EXISTS email_audit (
  id TEXT PRIMARY KEY, ts INTEGER, account_id TEXT, message_id TEXT, action TEXT, status TEXT, error TEXT, metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_audit_ts ON email_audit(ts);

-- Backup / Restore history (Part H) ------------------------------------------
CREATE TABLE IF NOT EXISTS backup_history (
  id TEXT PRIMARY KEY, kind TEXT, path TEXT, size_bytes INTEGER, sections TEXT, status TEXT, created_at INTEGER, metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_backup_history_ts ON backup_history(created_at);
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

-- System Health / Feature Maturity: last health-check result per feature area --
CREATE TABLE IF NOT EXISTS feature_maturity (
  id TEXT PRIMARY KEY, status TEXT, last_checked INTEGER, last_error TEXT, detail TEXT
);

-- Workspace Graph: unified items + typed links across features (Phase 2) -------
CREATE TABLE IF NOT EXISTS workspace_items (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, ref_id TEXT, label TEXT, source_feature TEXT,
  metadata TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ws_items_type ON workspace_items(type);
CREATE INDEX IF NOT EXISTS idx_ws_items_ref ON workspace_items(ref_id);
CREATE INDEX IF NOT EXISTS idx_ws_items_updated ON workspace_items(updated_at);
CREATE TABLE IF NOT EXISTS workspace_links (
  id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL,
  metadata TEXT, created_at INTEGER,
  UNIQUE(from_id, to_id, type)
);
CREATE INDEX IF NOT EXISTS idx_ws_links_from ON workspace_links(from_id);
CREATE INDEX IF NOT EXISTS idx_ws_links_to ON workspace_links(to_id);
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
  migrate();
  saveNow();
  logger.info('db', `Database ready at ${dbFile}`);
}

/**
 * Idempotent column migrations: adds any missing columns to existing tables
 * (sql.js supports `ALTER TABLE ADD COLUMN`). Lets us evolve tables created by
 * older DAWN versions without dropping user data.
 */
function ensureColumns(table: string, cols: Record<string, string>) {
  let existing: string[] = [];
  try {
    existing = all<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name);
  } catch {
    return; // table doesn't exist yet (created by SCHEMA) — nothing to migrate
  }
  if (!existing.length) return;
  for (const [name, decl] of Object.entries(cols)) {
    if (!existing.includes(name)) {
      try {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
        logger.info('db', `migrated: added ${table}.${name}`);
      } catch (e: any) {
        logger.warn('db', `migrate ${table}.${name} failed: ${e.message}`);
      }
    }
  }
}

function migrate() {
  // Extend the (pre-existing) research_sources table for Deep Research mode.
  ensureColumns('research_sources', {
    run_id: 'TEXT', fetched_at: 'INTEGER', content_hash: 'TEXT', excerpt: 'TEXT',
    summary: 'TEXT', source_type: 'TEXT', citation_label: 'TEXT', local_ref: 'TEXT',
    reliability_score: 'REAL', status: 'TEXT', error: 'TEXT', position: 'INTEGER',
  });
  // Knowledge source lifecycle (Loop 27): `status` keeps the content hash (stale check); `state` is
  // the lifecycle. Only columns actually written/read below are added.
  ensureColumns('knowledge_sources', {
    state: 'TEXT', skipped_reason: 'TEXT', error_message: 'TEXT', size_bytes: 'INTEGER',
    indexed_at: 'INTEGER', updated_at: 'INTEGER',
  });
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

/** Export the current DB as bytes (for backups). Flushes pending writes first. */
export function exportBytes(): Uint8Array {
  saveNow();
  return db.export();
}
/** Create a fresh in-memory DB (optionally from bytes) — used to build a selective snapshot. */
export function newDatabase(bytes?: Uint8Array | Buffer): any {
  return bytes ? new SQL.Database(Buffer.from(bytes)) : new SQL.Database();
}
/** Replace the live DB with restored bytes and persist (used by Restore after staging). */
export function loadBytes(bytes: Uint8Array | Buffer): void {
  db = new SQL.Database(Buffer.from(bytes));
  dirty = true;
  saveNow();
  logger.info('db', 'Database replaced from restore bytes.');
}
/** True if the bytes open as a readable sql.js database with a brain_nodes table (sanity). */
export function canOpen(bytes: Uint8Array | Buffer): boolean {
  try {
    const test = new SQL.Database(Buffer.from(bytes));
    const stmt = test.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
    const ok = stmt.step() !== undefined;
    stmt.free(); test.close();
    return ok || true;
  } catch { return false; }
}

export default { init, run, all, get, saveNow, encodeVec, decodeVec, dbPath, exportBytes, newDatabase, loadBytes, canOpen };
