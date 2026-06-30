/**
 * documents.ts — Documents workspace service. Local CRUD (SQLite), autosave,
 * version history, and local-model AI actions (rewrite/summarize/expand/shorten/
 * fix-grammar/checklist/extract-actions). Document text is passed to the model only
 * through DAWN's untrusted-data firewall. Import/export via docCore parsers.
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import runtime from '../runtime';
import settings from '../settings';
import * as llama from '../llama';
import security from '../security/promptSecurity';
import core, { DocAction } from './docCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

function snapshot(docId: string, content: string, label: string) {
  db.run('INSERT INTO document_versions (id,doc_id,content,label,created_at) VALUES (?,?,?,?,?)', [newId(), docId, content, label, now()]);
  // keep history bounded
  const ids = db.all('SELECT id FROM document_versions WHERE doc_id=? ORDER BY created_at DESC', [docId]).map((r: any) => r.id);
  for (const old of ids.slice(40)) db.run('DELETE FROM document_versions WHERE id=?', [old]);
}

export function list() {
  return db.all('SELECT id,title,format,archived,created_at,updated_at,length(content) AS size FROM documents ORDER BY updated_at DESC LIMIT 500');
}
export function get(id: string) {
  return db.get('SELECT * FROM documents WHERE id=?', [id]);
}
export function create(opts: { title?: string; content?: string; format?: string } = {}) {
  const id = newId();
  db.run('INSERT INTO documents (id,title,content,format,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?)',
    [id, opts.title || 'Untitled document', opts.content || '', opts.format || 'markdown', now(), now(), '{}']);
  rebuildGraph();
  return get(id);
}
export function update(id: string, patch: { title?: string; content?: string; archived?: number }) {
  const doc: any = get(id);
  if (!doc) return null;
  const title = patch.title !== undefined ? patch.title : doc.title;
  const content = patch.content !== undefined ? patch.content : doc.content;
  const archived = patch.archived !== undefined ? patch.archived : doc.archived;
  db.run('UPDATE documents SET title=?, content=?, archived=?, updated_at=? WHERE id=?', [title, content, archived, now(), id]);
  if (patch.title !== undefined || patch.archived !== undefined) rebuildGraph();
  return get(id);
}
export function remove(id: string) {
  db.run('DELETE FROM documents WHERE id=?', [id]);
  db.run('DELETE FROM document_versions WHERE doc_id=?', [id]);
  rebuildGraph();
  return true;
}
export function saveVersion(id: string, label = 'Manual save') {
  const doc: any = get(id);
  if (!doc) return null;
  snapshot(id, doc.content, label);
  return versions(id);
}
export function versions(id: string) {
  return db.all('SELECT id,label,created_at,length(content) AS size FROM document_versions WHERE doc_id=? ORDER BY created_at DESC', [id]);
}
export function restoreVersion(docId: string, versionId: string) {
  const v: any = db.get('SELECT * FROM document_versions WHERE id=? AND doc_id=?', [versionId, docId]);
  const doc: any = get(docId);
  if (!v || !doc) return null;
  snapshot(docId, doc.content, 'Before restore');
  db.run('UPDATE documents SET content=?, updated_at=? WHERE id=?', [v.content, now(), docId]);
  return get(docId);
}

/** Run a local-model AI action on a document; snapshots a version first. */
export async function aiAction(id: string, action: DocAction): Promise<{ ok: boolean; error?: string; content?: string }> {
  const doc: any = get(id);
  if (!doc) return { ok: false, error: 'Document not found.' };
  if (!core.ACTIONS[action]) return { ok: false, error: 'Unknown action.' };
  if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model first.' };
  if (!String(doc.content || '').trim()) return { ok: false, error: 'The document is empty.' };

  try {
    const def = core.ACTIONS[action];
    // PromptSecurity: scan the (untrusted) document for injection + audit, then assert the
    // wrapped content never landed in a system role before sending.
    security.inspect(doc.title, doc.content, 'document', id, `doc:${id}`);
    const messages = core.buildActionMessages(action, doc.title, doc.content);
    security.assertNoUntrustedSystemRole(messages);
    const raw = await llama.chat(runtime.baseUrl(), messages, { temperature: def.temperature, top_p: 0.9, max_tokens: 2048 });
    const result = stripFences(raw);
    if (!result.trim()) return { ok: false, error: 'The model returned nothing.' };
    snapshot(id, doc.content, `Before: ${def.label}`);
    const newContent = core.applyResult(action, doc.content, result);
    db.run('UPDATE documents SET content=?, updated_at=? WHERE id=?', [newContent, now(), id]);
    logger.info('docs', `AI ${action} on "${doc.title}"`);
    return { ok: true, content: newContent };
  } catch (e: any) {
    logger.error('docs', `AI ${action} failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

/** Import a local file (md/txt/html/csv) into a new document. PDF/DOCX: parser interface ready. */
export function importFile(filePath: string): { ok: boolean; error?: string; id?: string } {
  try {
    const name = filePath.split(/[\\/]/).pop() || 'document';
    const parser = core.parserFor(name);
    if (!parser) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (ext === 'pdf' || ext === 'docx') return { ok: false, error: `${ext.toUpperCase()} import isn't available yet — a parser interface is in place for it. Supported now: ${core.SUPPORTED_IMPORT.join(', ')}.` };
      return { ok: false, error: `Unsupported file type. Supported: ${core.SUPPORTED_IMPORT.join(', ')}.` };
    }
    const data = fs.readFileSync(filePath);
    if (data.length > 8 * 1024 * 1024) return { ok: false, error: 'File too large (max 8 MB).' };
    const parsed = parser.parse(name, data);
    const doc: any = create({ title: parsed.title, content: parsed.content, format: parsed.format });
    return { ok: true, id: doc.id };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export function exportDoc(id: string, format: 'md' | 'txt' | 'html' | 'csv') {
  const doc: any = get(id);
  if (!doc) return { ok: false, error: 'Document not found.' };
  const out = core.exportDoc(format, doc.title, doc.content || '');
  return { ok: true, ...out };
}

export const supportedImport = core.SUPPORTED_IMPORT;

function stripFences(s: string): string {
  const m = String(s || '').match(/^```[\w]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : String(s || '');
}
function rebuildGraph() { try { require('../graph').default.rebuild(); } catch { /* */ } }

export default {
  list, get, create, update, remove, saveVersion, versions, restoreVersion,
  aiAction, importFile, exportDoc, supportedImport,
};
