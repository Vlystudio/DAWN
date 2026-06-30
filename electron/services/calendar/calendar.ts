/**
 * calendar.ts — local Calendar-lite. Events stored in SQLite; tasks with due dates
 * are overlaid as read-only items so deadlines and events show together. Import/export
 * iCalendar (.ics). A CalDAV provider interface exists (calCore) but is off by default
 * and not implemented here — local-first, no credentials required.
 */
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import security from '../security/promptSecurity';
import core, { CalEvent } from './calCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

export interface CalItem {
  id: string; title: string; details?: string; location?: string;
  start_at: number; end_at?: number | null; all_day: boolean;
  kind: 'event' | 'task'; source_type?: string; source_id?: string; priority?: string; overdue?: boolean;
}

/** All calendar items (events + tasks with due dates) overlapping [start, end]. */
export function list(start: number, end: number): CalItem[] {
  const events = db.all('SELECT * FROM calendar_events WHERE start_at < ? AND COALESCE(end_at, start_at) >= ? ORDER BY start_at ASC', [end, start]);
  const items: CalItem[] = events.map((e: any) => ({
    id: e.id, title: e.title, details: e.details, location: e.location,
    start_at: e.start_at, end_at: e.end_at, all_day: !!e.all_day, kind: 'event', source_type: e.source_type, source_id: e.source_id,
  }));
  // tasks with a due date in range → read-only calendar items
  for (const t of db.all('SELECT id,title,details,due_at,priority,status FROM tasks WHERE due_at IS NOT NULL AND due_at >= ? AND due_at < ?', [start, end])) {
    items.push({
      id: `task:${t.id}`, title: t.title, details: t.details, start_at: t.due_at, end_at: t.due_at, all_day: false,
      kind: 'task', source_type: 'task', source_id: t.id, priority: t.priority, overdue: t.status !== 'done' && t.due_at < now(),
    });
  }
  return items.sort((a, b) => a.start_at - b.start_at);
}

export function create(e: Partial<CalEvent>) {
  const id = newId();
  db.run('INSERT INTO calendar_events (id,title,details,location,start_at,end_at,all_day,uid,source_type,source_id,created_at,updated_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, e.title || 'Untitled event', e.details || '', e.location || '', e.start_at || now(), e.end_at || null, e.all_day ? 1 : 0, e.uid || id, (e as any).source_type || null, (e as any).source_id || null, now(), now(), '{}']);
  return get(id);
}
export function get(id: string) { return db.get('SELECT * FROM calendar_events WHERE id=?', [id]); }
export function update(id: string, patch: any) {
  const e: any = get(id);
  if (!e) return null;
  const f = (k: string) => (patch[k] !== undefined ? patch[k] : e[k]);
  db.run('UPDATE calendar_events SET title=?, details=?, location=?, start_at=?, end_at=?, all_day=?, updated_at=? WHERE id=?',
    [f('title'), f('details'), f('location'), f('start_at'), f('end_at'), patch.all_day !== undefined ? (patch.all_day ? 1 : 0) : e.all_day, now(), id]);
  return get(id);
}
export function remove(id: string) { db.run('DELETE FROM calendar_events WHERE id=?', [id]); return true; }

/** Export events (optionally within a range) as an .ics string. */
export function exportIcs(start?: number, end?: number): { ok: boolean; filename: string; content: string } {
  const rows = start && end
    ? db.all('SELECT * FROM calendar_events WHERE start_at < ? AND COALESCE(end_at, start_at) >= ? ORDER BY start_at ASC', [end, start])
    : db.all('SELECT * FROM calendar_events ORDER BY start_at ASC');
  const content = core.generateIcs(rows.map((e: any) => ({ id: e.id, uid: e.uid, title: e.title, details: e.details, location: e.location, start_at: e.start_at, end_at: e.end_at, all_day: !!e.all_day })));
  return { ok: true, filename: `dawn-calendar-${new Date().toISOString().slice(0, 10)}.ics`, content };
}

/** Import events from an .ics string. De-dupes on UID. */
export function importIcs(content: string): { ok: boolean; imported: number; error?: string } {
  try {
    const parsed = core.parseIcs(content);
    let imported = 0;
    for (const e of parsed) {
      if (e.uid && db.get('SELECT id FROM calendar_events WHERE uid=?', [e.uid])) continue;
      // Imported .ics descriptions are untrusted external data — scan + audit on the way in.
      if (e.details || e.title) security.inspect(e.title || 'event', `${e.title}\n${e.details || ''}`, 'calendar', e.uid);
      create(e);
      imported++;
    }
    logger.info('calendar', `Imported ${imported} event(s) from .ics`);
    return { ok: true, imported };
  } catch (e: any) {
    return { ok: false, imported: 0, error: e.message };
  }
}

export default { list, create, get, update, remove, exportIcs, importIcs };
