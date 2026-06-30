/**
 * globalSearchCore.ts — pure, electron-free heart of DAWN's Global Search: the catalog of
 * searchable sources (deliberately excluding the vault and any secret-bearing table), safe
 * parameterized LIKE-query construction (wildcards escaped), snippet redaction, and result
 * ranking. The electron service runs the SQL; this module is unit-tested without a DB.
 *
 * Security: the vault, auth, and audit tables are NOT searchable. Snippets are redacted of
 * obvious secret patterns before they ever leave the service.
 */

export interface SearchSource {
  type: string;        // result type id
  label: string;       // human label
  table: string;       // DB table
  titleCol: string;    // primary text column
  snippetCol?: string; // secondary text column for a preview
  idCol?: string;      // primary key column (default 'id')
  route: string;       // uiCore route to open
  extraWhere?: string; // appended to WHERE (e.g. archived=0)
  orderBy?: string;    // ORDER BY tail
}

/**
 * The searchable surface. Note what's absent: vault_items, auth_config, totp_backup_codes,
 * tool_audit, prompt_security_events, email credentials — never searched.
 */
export const SEARCH_SOURCES: SearchSource[] = [
  { type: 'conversation', label: 'Chat', table: 'conversations', titleCol: 'title', route: 'chat', orderBy: 'updated_at DESC' },
  { type: 'message', label: 'Message', table: 'messages', titleCol: 'content', idCol: 'conversation_id', route: 'chat', orderBy: 'created_at DESC' },
  { type: 'memory', label: 'Memory', table: 'memories', titleCol: 'content', snippetCol: 'source', route: 'memory' },
  { type: 'note', label: 'Note', table: 'notes', titleCol: 'title', snippetCol: 'content', route: 'notes', extraWhere: 'archived=0', orderBy: 'updated_at DESC' },
  { type: 'task', label: 'Task', table: 'tasks', titleCol: 'title', snippetCol: 'details', route: 'tasks', orderBy: 'created_at DESC' },
  { type: 'document', label: 'Document', table: 'documents', titleCol: 'title', snippetCol: 'content', route: 'documents', extraWhere: 'archived=0', orderBy: 'updated_at DESC' },
  { type: 'event', label: 'Calendar', table: 'calendar_events', titleCol: 'title', snippetCol: 'location', route: 'calendar', orderBy: 'start_at DESC' },
  { type: 'research', label: 'Research', table: 'research_runs', titleCol: 'question', snippetCol: 'status', route: 'research', orderBy: 'started_at DESC' },
  { type: 'skill', label: 'Skill', table: 'skills', titleCol: 'name', snippetCol: 'description', route: 'skills' },
  { type: 'workspace', label: 'Workspace', table: 'workspace_items', titleCol: 'label', snippetCol: 'type', route: 'workspace', orderBy: 'updated_at DESC' },
  // Email: subject + sender only (never the body — body is untrusted/sensitive).
  { type: 'email', label: 'Email', table: 'email_messages', titleCol: 'subject', snippetCol: 'from_name', route: 'email', orderBy: 'date DESC' },
];

export interface SearchResult { type: string; label: string; id: string; title: string; snippet: string; route: string }

/** Escape LIKE wildcards in a user term so they're matched literally (used with ESCAPE '\'). */
export function escapeLike(term: string): string {
  return String(term || '').replace(/[\\%_]/g, (c) => '\\' + c);
}

/** Build a parameterized LIKE query for a source. Never string-concatenates the term. */
export function buildLikeQuery(src: SearchSource, term: string, limit = 8): { sql: string; params: any[] } {
  const id = src.idCol || 'id';
  const cols = [src.titleCol, src.snippetCol].filter(Boolean) as string[];
  const like = `%${escapeLike(term)}%`;
  const whereLike = cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ');
  const where = `(${whereLike})${src.extraWhere ? ` AND ${src.extraWhere}` : ''}`;
  const sel = `${id} AS id, ${src.titleCol} AS title${src.snippetCol ? `, ${src.snippetCol} AS snippet` : ''}`;
  const order = src.orderBy ? ` ORDER BY ${src.orderBy}` : '';
  const sql = `SELECT ${sel} FROM ${src.table} WHERE ${where}${order} LIMIT ${Math.max(1, Math.min(50, limit | 0))}`;
  const params = cols.map(() => like);
  return { sql, params };
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g, /ntn_[A-Za-z0-9]{16,}/g, /ghp_[A-Za-z0-9]{16,}/g, /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi, /\b[A-Z2-7]{20,}\b/g, /-----BEGIN[^-]+PRIVATE KEY-----/g,
  /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');

/** Clean + redact a snippet: strip control chars, mask obvious secrets, collapse + truncate. */
export function redactSnippet(s: string, max = 140): string {
  let out = String(s || '').replace(CONTROL_CHARS, ' ');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '⟨redacted⟩');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

/** A short, redacted title (titles can be long for message/memory rows). */
export function cleanTitle(s: string, max = 80): string {
  return redactSnippet(s, max) || 'Untitled';
}

/** Rank: exact/title-prefix matches first, then title-contains, then snippet-only. Stable otherwise. */
export function rankResults(results: SearchResult[], term: string): SearchResult[] {
  const t = String(term || '').toLowerCase();
  const score = (r: SearchResult) => {
    const title = (r.title || '').toLowerCase();
    if (title === t) return 0;
    if (title.startsWith(t)) return 1;
    if (title.includes(t)) return 2;
    return 3;
  };
  return [...results].sort((a, b) => score(a) - score(b));
}

export default { SEARCH_SOURCES, escapeLike, buildLikeQuery, redactSnippet, cleanTitle, rankResults };
