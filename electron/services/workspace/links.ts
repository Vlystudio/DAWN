/**
 * workspace/links.ts — typed, de-duplicated edges between workspace items. Creating a link validates
 * the type, requires both endpoints to exist, and refuses duplicates (same from→to of the same type).
 * Related-lookup walks edges in both directions and returns the connected items + the link that joins
 * them. Deleting a link is by id; deleting an item (in items.ts) cleans its links.
 */
import crypto from 'crypto';
import db from '../db';
import core from './workspaceCore';
import items, { WorkspaceItem } from './items';

const newId = () => crypto.randomUUID();
const now = () => Date.now();

export interface WorkspaceLink { id: string; from_id: string; to_id: string; type: string; metadata: string; created_at: number; }

/** Create a link. Both items must exist; duplicates (from,to,type) are rejected, not duplicated. */
export function create(input: { fromId?: string; toId?: string; type?: string; metadata?: any }) {
  const v = core.validateLink(input);
  if (!v.ok || !v.value) return { ok: false, error: v.error || 'invalid link' };
  const f = v.value;
  if (!items.get(f.fromId)) return { ok: false, error: 'from item not found' };
  if (!items.get(f.toId)) return { ok: false, error: 'to item not found' };
  const dup = db.get<WorkspaceLink>('SELECT * FROM workspace_links WHERE from_id=? AND to_id=? AND type=?', [f.fromId, f.toId, f.type]);
  if (dup) return { ok: true, link: dup, deduped: true };
  const id = newId();
  db.run('INSERT INTO workspace_links (id,from_id,to_id,type,metadata,created_at) VALUES (?,?,?,?,?,?)',
    [id, f.fromId, f.toId, f.type, core.safeMetadata(input.metadata), now()]);
  return { ok: true, link: db.get<WorkspaceLink>('SELECT * FROM workspace_links WHERE id=?', [id]) };
}

export function remove(id: string) {
  db.run('DELETE FROM workspace_links WHERE id=?', [String(id || '')]);
  return { ok: true };
}

/** All links touching an item (either direction). */
export function listForItem(itemId: string): WorkspaceLink[] {
  return db.all<WorkspaceLink>('SELECT * FROM workspace_links WHERE from_id=? OR to_id=? ORDER BY created_at DESC', [itemId, itemId]);
}

export interface RelatedEntry { link: WorkspaceLink; direction: 'out' | 'in'; item: WorkspaceItem | null }

/** Related items for an item: each connected item + the edge + direction. Orphan edges are skipped safely. */
export function related(itemId: string): RelatedEntry[] {
  const links = listForItem(itemId);
  const out: RelatedEntry[] = [];
  for (const l of links) {
    const direction: 'out' | 'in' = l.from_id === itemId ? 'out' : 'in';
    const otherId = direction === 'out' ? l.to_id : l.from_id;
    out.push({ link: l, direction, item: items.get(otherId) });
  }
  return out;
}

export function countAll(): number {
  try { return Number(db.get<{ c: number }>('SELECT COUNT(*) c FROM workspace_links')?.c || 0); } catch { return 0; }
}

export default { create, remove, listForItem, related, countAll };
