/**
 * workspace/items.ts — CRUD for workspace graph items. An "item" is a lightweight, typed,
 * cross-feature handle (e.g. a note, task, research run, email message) the graph can link and
 * search. It optionally references the underlying feature row via ref_id. All metadata is passed
 * through workspaceCore.safeMetadata (never throws, capped, no blobs). Deleting an item also
 * removes its links (no dangling edges).
 */
import crypto from 'crypto';
import db from '../db';
import core from './workspaceCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

export interface WorkspaceItem {
  id: string; type: string; ref_id: string | null; label: string; source_feature: string;
  metadata: string; created_at: number; updated_at: number;
}

/** Create an item. If (type, ref_id) already exists, returns the existing item (idempotent upsert). */
export function create(input: { type?: string; label?: string; refId?: string; sourceFeature?: string; metadata?: any }) {
  const v = core.validateItem(input);
  if (!v.ok || !v.value) return { ok: false, error: v.error || 'invalid item' };
  const f = v.value;
  if (f.refId) {
    const existing = db.get<WorkspaceItem>('SELECT * FROM workspace_items WHERE type=? AND ref_id=?', [f.type, f.refId]);
    if (existing) {
      db.run('UPDATE workspace_items SET label=?, source_feature=?, metadata=?, updated_at=? WHERE id=?',
        [f.label, f.sourceFeature, f.metadata, now(), existing.id]);
      return { ok: true, item: get(existing.id), deduped: true };
    }
  }
  const id = newId(); const t = now();
  db.run('INSERT INTO workspace_items (id,type,ref_id,label,source_feature,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, f.type, f.refId, f.label, f.sourceFeature, f.metadata, t, t]);
  return { ok: true, item: get(id) };
}

export function get(id: string): WorkspaceItem | null {
  return db.get<WorkspaceItem>('SELECT * FROM workspace_items WHERE id=?', [String(id || '')]);
}

export function update(id: string, patch: { label?: string; sourceFeature?: string; metadata?: any }) {
  const item = get(id);
  if (!item) return { ok: false, error: 'not found' };
  const label = patch.label != null ? core.cleanLabel(patch.label) : item.label;
  const sourceFeature = patch.sourceFeature != null ? String(patch.sourceFeature) : item.source_feature;
  const metadata = patch.metadata !== undefined ? core.safeMetadata(patch.metadata) : item.metadata;
  db.run('UPDATE workspace_items SET label=?, source_feature=?, metadata=?, updated_at=? WHERE id=?',
    [label, sourceFeature, metadata, now(), id]);
  return { ok: true, item: get(id) };
}

/** Delete an item and any links touching it (no dangling edges). */
export function remove(id: string) {
  const item = get(id);
  if (!item) return { ok: false, error: 'not found' };
  db.run('DELETE FROM workspace_links WHERE from_id=? OR to_id=?', [id, id]);
  db.run('DELETE FROM workspace_items WHERE id=?', [id]);
  return { ok: true };
}

/** List/filter items by type, source feature, label substring, and updated-since. */
export function list(opts: { type?: string; sourceFeature?: string; q?: string; since?: number; limit?: number } = {}): WorkspaceItem[] {
  const where: string[] = []; const params: any[] = [];
  if (opts.type && core.isValidItemType(opts.type)) { where.push('type=?'); params.push(opts.type); }
  if (opts.sourceFeature) { where.push('source_feature=?'); params.push(String(opts.sourceFeature)); }
  if (opts.q && String(opts.q).trim()) { where.push('label LIKE ? ESCAPE \'\\\''); params.push('%' + String(opts.q).trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
  if (typeof opts.since === 'number') { where.push('updated_at >= ?'); params.push(opts.since); }
  const limit = Math.max(1, Math.min(500, opts.limit || 200));
  const sql = `SELECT * FROM workspace_items${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ${limit}`;
  return db.all<WorkspaceItem>(sql, params);
}

export function countAll(): number {
  try { return Number(db.get<{ c: number }>('SELECT COUNT(*) c FROM workspace_items')?.c || 0); } catch { return 0; }
}

export default { create, get, update, remove, list, countAll };
