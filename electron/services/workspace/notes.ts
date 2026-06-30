/**
 * notes.ts — quick notes with tags, pin/archive, search, and local-model AI helpers
 * (summarize, convert-to-task, smart-link to memories/projects/conversations). Note
 * text is only sent to the model through DAWN's untrusted-data firewall.
 */
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import runtime from '../runtime';
import settings from '../settings';
import * as llama from '../llama';
import security from '../security/promptSecurity';
import core from './wsCore';
import tasks from './tasks';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const rebuild = () => { try { require('../graph').default.rebuild(); } catch { /* */ } };

export function list(opts: { archived?: boolean } = {}) {
  return db.all('SELECT * FROM notes WHERE archived=? ORDER BY pinned DESC, updated_at DESC LIMIT 500', [opts.archived ? 1 : 0]);
}
export function get(id: string) {
  const note: any = db.get('SELECT * FROM notes WHERE id=?', [id]);
  if (!note) return null;
  return { ...note, links: db.all('SELECT * FROM note_links WHERE note_id=? ORDER BY created_at DESC', [id]) };
}
export function search(q: string) {
  const like = `%${String(q || '').trim()}%`;
  return db.all('SELECT * FROM notes WHERE archived=0 AND (title LIKE ? OR content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT 100', [like, like, like]);
}
export function create(opts: { title?: string; content?: string; tags?: string } = {}) {
  const id = newId();
  db.run('INSERT INTO notes (id,title,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    [id, opts.title || '', opts.content || '', opts.tags || '', now(), now()]);
  rebuild();
  return get(id);
}
export function update(id: string, patch: any) {
  const n: any = db.get('SELECT * FROM notes WHERE id=?', [id]);
  if (!n) return null;
  const f = (k: string) => (patch[k] !== undefined ? patch[k] : n[k]);
  db.run('UPDATE notes SET title=?, content=?, tags=?, pinned=?, archived=?, updated_at=? WHERE id=?',
    [f('title'), f('content'), f('tags'), f('pinned'), f('archived'), now(), id]);
  rebuild();
  return get(id);
}
export function remove(id: string) {
  db.run('DELETE FROM notes WHERE id=?', [id]);
  db.run('DELETE FROM note_links WHERE note_id=?', [id]);
  rebuild();
  return true;
}

export async function aiSummarize(id: string): Promise<{ ok: boolean; error?: string; content?: string }> {
  const n: any = db.get('SELECT * FROM notes WHERE id=?', [id]);
  if (!n) return { ok: false, error: 'Note not found.' };
  if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model first.' };
  if (!String(n.content || '').trim()) return { ok: false, error: 'The note is empty.' };
  try {
    security.inspect(n.title, n.content, 'note', id, `note:${id}`);
    const messages = core.buildSummarizeMessages(n.title, n.content);
    security.assertNoUntrustedSystemRole(messages);
    const raw = await llama.chat(runtime.baseUrl(), messages, { temperature: 0.4, max_tokens: 400 });
    const summary = raw.trim();
    const content = `> **Summary**\n${summary.split('\n').map((l) => '> ' + l).join('\n')}\n\n---\n\n${n.content}`;
    db.run('UPDATE notes SET content=?, updated_at=? WHERE id=?', [content, now(), id]);
    return { ok: true, content };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export async function aiToTask(id: string): Promise<{ ok: boolean; error?: string; taskId?: string; title?: string }> {
  const n: any = db.get('SELECT * FROM notes WHERE id=?', [id]);
  if (!n) return { ok: false, error: 'Note not found.' };
  if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model first.' };
  try {
    security.inspect(n.title, n.content, 'note', id, `note:${id}`);
    const messages = core.buildToTaskMessages(n.title, n.content);
    security.assertNoUntrustedSystemRole(messages);
    const raw = await llama.chat(runtime.baseUrl(), messages, { temperature: 0.3, max_tokens: 400 });
    const t = core.parseTask(raw, n.title || 'Task');
    const task: any = tasks.create({ title: t.title, details: t.details, priority: t.priority, source_type: 'note', source_id: id });
    db.run('INSERT INTO note_links (id,note_id,target_type,target_id,label,created_at) VALUES (?,?,?,?,?,?)', [newId(), id, 'task', task.id, t.title, now()]);
    rebuild();
    return { ok: true, taskId: task.id, title: t.title };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

/**
 * Smart-link a note to related memories / conversations / projects by keyword overlap
 * (local, deterministic — no network). Creates note_links.
 */
export function aiLink(id: string): { ok: boolean; error?: string; links?: any[] } {
  const n: any = db.get('SELECT * FROM notes WHERE id=?', [id]);
  if (!n) return { ok: false, error: 'Note not found.' };
  const kws = core.keywords(`${n.title} ${n.content}`);
  if (!kws.length) return { ok: true, links: [] };
  const created: any[] = [];
  const link = (type: string, targetId: string, label: string) => {
    if (db.get('SELECT id FROM note_links WHERE note_id=? AND target_type=? AND target_id=?', [id, type, targetId])) return;
    const lid = newId();
    db.run('INSERT INTO note_links (id,note_id,target_type,target_id,label,created_at) VALUES (?,?,?,?,?,?)', [lid, id, type, targetId, label, now()]);
    created.push({ id: lid, target_type: type, target_id: targetId, label });
  };
  // memories
  for (const kw of kws.slice(0, 4)) {
    for (const m of db.all('SELECT id,content FROM memories WHERE content LIKE ? LIMIT 2', [`%${kw}%`])) {
      link('memory', m.id, String(m.content).slice(0, 60));
    }
  }
  // conversations
  for (const kw of kws.slice(0, 4)) {
    for (const c of db.all('SELECT id,title FROM conversations WHERE title LIKE ? LIMIT 2', [`%${kw}%`])) {
      link('conversation', c.id, c.title || 'Conversation');
    }
  }
  // projects (from settings)
  for (const proj of settings.get().projects || []) {
    const base = proj.toLowerCase().split('/')[0].trim();
    if (kws.some((k) => base.includes(k) || k.includes(base.split(' ')[0]))) link('project', base, proj);
  }
  logger.info('notes', `Linked note ${id.slice(0, 8)} → ${created.length} items`);
  rebuild();
  return { ok: true, links: created };
}

export function unlink(linkId: string) { db.run('DELETE FROM note_links WHERE id=?', [linkId]); rebuild(); return true; }

export default { list, get, search, create, update, remove, aiSummarize, aiToTask, aiLink, unlink };
