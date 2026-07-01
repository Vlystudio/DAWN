/**
 * tasks.ts — tasks with due dates, priority, status, recurrence, reminders, history,
 * and an "Ask DAWN to work on this" action (local-model plan stored in history).
 * Tasks become brain nodes; overdue tasks are flagged. No network.
 */
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import runtime from '../runtime';
import * as llama from '../llama';
import security from '../security/promptSecurity';
import core, { Priority, Status, Recurrence } from './wsCore';
import live from './liveHooks';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const rebuild = () => { try { require('../graph').default.rebuild(); } catch { /* */ } };

function logEvent(taskId: string, kind: string, detail = '') {
  db.run('INSERT INTO task_events (id,task_id,kind,detail,created_at) VALUES (?,?,?,?,?)', [newId(), taskId, kind, detail, now()]);
}

export function list(opts: { status?: string; includeDone?: boolean } = {}) {
  let rows: any[];
  if (opts.status) rows = db.all('SELECT * FROM tasks WHERE status=? ORDER BY (due_at IS NULL), due_at ASC, created_at DESC', [opts.status]);
  else if (opts.includeDone) rows = db.all('SELECT * FROM tasks ORDER BY (status=\'done\'), (due_at IS NULL), due_at ASC, created_at DESC LIMIT 500');
  else rows = db.all('SELECT * FROM tasks WHERE status<>\'done\' ORDER BY (due_at IS NULL), due_at ASC, created_at DESC LIMIT 500');
  return rows.map((t) => ({ ...t, overdue: core.isOverdue(t) }));
}
export function get(id: string) {
  const t: any = db.get('SELECT * FROM tasks WHERE id=?', [id]);
  if (!t) return null;
  return { ...t, overdue: core.isOverdue(t), events: db.all('SELECT * FROM task_events WHERE task_id=? ORDER BY created_at DESC', [id]) };
}
export function create(opts: { title?: string; details?: string; priority?: Priority; status?: Status; due_at?: number | null; remind_at?: number | null; recurrence?: Recurrence; source_type?: string; source_id?: string }) {
  const id = newId();
  db.run(
    'INSERT INTO tasks (id,title,details,status,priority,due_at,remind_at,recurrence,reminded,source_type,source_id,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, opts.title || 'Untitled task', opts.details || '', opts.status || 'todo', opts.priority || 'normal',
      opts.due_at || null, opts.remind_at || null, opts.recurrence || 'none', 0, opts.source_type || null, opts.source_id || null, now(), now(), '{}']);
  logEvent(id, 'created', opts.title || '');
  rebuild();
  const r: any = get(id);
  live.register('task', id, r?.title || 'Task', 'tasks'); // live workspace registration
  return r;
}
export function update(id: string, patch: any) {
  const t: any = db.get('SELECT * FROM tasks WHERE id=?', [id]);
  if (!t) return null;
  const f = (k: string) => (patch[k] !== undefined ? patch[k] : t[k]);
  const remindReset = patch.remind_at !== undefined && patch.remind_at !== t.remind_at ? 0 : t.reminded;
  db.run('UPDATE tasks SET title=?, details=?, status=?, priority=?, due_at=?, remind_at=?, recurrence=?, reminded=?, updated_at=? WHERE id=?',
    [f('title'), f('details'), f('status'), f('priority'), f('due_at'), f('remind_at'), f('recurrence'), remindReset, now(), id]);
  rebuild();
  const r: any = get(id);
  live.register('task', id, r?.title || 'Task', 'tasks'); // live update
  return r;
}
export function remove(id: string) {
  db.run('DELETE FROM tasks WHERE id=?', [id]);
  db.run('DELETE FROM task_events WHERE task_id=?', [id]);
  live.remove('task', id); // live prune of the workspace item
  rebuild();
  return true;
}

export function setStatus(id: string, status: Status) {
  const t: any = db.get('SELECT * FROM tasks WHERE id=?', [id]);
  if (!t) return null;
  if (status === 'done') return complete(id);
  db.run('UPDATE tasks SET status=?, completed_at=NULL, updated_at=? WHERE id=?', [status, now(), id]);
  logEvent(id, 'status', status);
  rebuild();
  return get(id);
}

/** Mark done; if recurring, spawn the next occurrence. */
export function complete(id: string) {
  const t: any = db.get('SELECT * FROM tasks WHERE id=?', [id]);
  if (!t) return null;
  db.run('UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id=?', ['done', now(), now(), id]);
  logEvent(id, 'completed');
  const next = core.nextDue(t.due_at, t.recurrence);
  if (next) {
    const shift = t.remind_at && t.due_at ? next - t.due_at : 0;
    create({ title: t.title, details: t.details, priority: t.priority, due_at: next, remind_at: t.remind_at ? t.remind_at + shift : null, recurrence: t.recurrence, source_type: 'recurrence', source_id: id });
    logEvent(id, 'recurred', new Date(next).toLocaleString());
  }
  rebuild();
  return get(id);
}

/** "Ask DAWN to work on this" — local model produces a plan, stored in task history. */
export async function askDawn(id: string): Promise<{ ok: boolean; error?: string; plan?: string }> {
  const t: any = db.get('SELECT * FROM tasks WHERE id=?', [id]);
  if (!t) return { ok: false, error: 'Task not found.' };
  if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model first.' };
  try {
    security.inspect(t.title, `${t.title}\n${t.details || ''}`, 'task', id, `task:${id}`);
    const messages = core.buildPlanMessages(t.title, t.details);
    security.assertNoUntrustedSystemRole(messages);
    const plan = (await llama.chat(runtime.baseUrl(), messages, { temperature: 0.4, max_tokens: 800 })).trim();
    logEvent(id, 'dawn_plan', plan);
    logger.info('tasks', `DAWN planned task ${id.slice(0, 8)}`);
    return { ok: true, plan };
  } catch (e: any) { return { ok: false, error: e.message }; }
}

export function events(id: string) { return db.all('SELECT * FROM task_events WHERE task_id=? ORDER BY created_at DESC', [id]); }
export function overdueCount(): number {
  return (db.get('SELECT COUNT(*) AS n FROM tasks WHERE status<>\'done\' AND due_at IS NOT NULL AND due_at < ?', [now()]) as any)?.n || 0;
}

/** Due reminders not yet fired (for the local notification poller). Marks them fired. */
export function takeDueReminders(): { id: string; title: string; due_at: number | null }[] {
  const due = db.all('SELECT id,title,due_at FROM tasks WHERE status<>\'done\' AND remind_at IS NOT NULL AND remind_at <= ? AND reminded=0', [now()]);
  for (const d of due) { db.run('UPDATE tasks SET reminded=1 WHERE id=?', [d.id]); logEvent(d.id, 'reminded'); }
  return due as any;
}

export default { list, get, create, update, remove, setStatus, complete, askDawn, events, overdueCount, takeDueReminders };
