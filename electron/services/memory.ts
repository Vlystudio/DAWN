import * as crypto from 'crypto';
import db from './db';
import settings from './settings';

/**
 * Memory — durable, user-controlled facts/preferences/projects/etc. Stored
 * locally. Separate from file knowledge. Saving sensitive items is always an
 * explicit, confirmed action from the UI (nothing auto-saves here).
 */

export type MemoryType =
  | 'preference' | 'project' | 'personal_fact' | 'workflow'
  | 'recurring_instruction' | 'technical_setup' | 'local_ai_setting' | 'creative_idea';

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  source: string;
  importance: number;
  confidence: number;
  pinned: number;
  last_used_at: number | null;
  created_at: number;
}

const newId = () => crypto.randomUUID();

export function list(): Memory[] {
  return db.all<Memory>('SELECT * FROM memories ORDER BY pinned DESC, created_at DESC');
}

export function add(content: string, type: MemoryType = 'personal_fact', source = 'manual'): Memory | null {
  const text = (content || '').trim();
  if (!text) return null;
  const m: Memory = {
    id: newId(), type, content: text, source,
    importance: 0.6, confidence: 0.8, pinned: 0, last_used_at: null, created_at: Date.now(),
  };
  db.run(
    'INSERT INTO memories (id,type,content,source,importance,confidence,pinned,last_used_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [m.id, m.type, m.content, m.source, m.importance, m.confidence, m.pinned, m.last_used_at, m.created_at]
  );
  return m;
}

export function update(id: string, patch: Partial<Memory>): Memory | null {
  const cur = db.get<Memory>('SELECT * FROM memories WHERE id=?', [id]);
  if (!cur) return null;
  const content = patch.content !== undefined ? String(patch.content).trim() : cur.content;
  const type = patch.type !== undefined ? patch.type : cur.type;
  const pinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : cur.pinned;
  db.run('UPDATE memories SET content=?, type=?, pinned=? WHERE id=?', [content, type, pinned, id]);
  return db.get<Memory>('SELECT * FROM memories WHERE id=?', [id]);
}

export function remove(id: string) {
  db.run('DELETE FROM memories WHERE id=?', [id]);
  db.run('DELETE FROM memory_links WHERE memory_id=?', [id]);
  return true;
}

export function clearAll() {
  db.run('DELETE FROM memories');
  db.run('DELETE FROM memory_links');
  return true;
}

/** Mark memories as used (lights them in the brain; updates last_used_at). */
export function touchUsed(ids: string[]) {
  const now = Date.now();
  for (const id of ids) db.run('UPDATE memories SET last_used_at=? WHERE id=?', [now, id]);
}

/**
 * Pick memories relevant to a query. MVP: simple keyword overlap + pinned boost
 * (semantic embeddings are a fast-follow). Returns the chosen memories.
 */
export function recall(query: string, limit = 6): Memory[] {
  if (!settings.get().memoryEnabled) return [];
  const all = list();
  if (!all.length) return [];
  const terms = (query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = all.map((m) => {
    const hay = m.content.toLowerCase();
    let score = m.pinned ? 2 : 0;
    for (const t of terms) if (hay.includes(t)) score += 1;
    return { m, score };
  });
  // Always include pinned; otherwise top keyword matches.
  const chosen = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return chosen.map((s) => s.m);
}

/** Build the system-prompt block from chosen memories. */
export function contextBlock(memories: Memory[]): string {
  if (!memories.length) return '';
  const lines = memories.map((m) => `- (${m.type}) ${m.content}`).join('\n');
  return `Durable facts & preferences about the user (use when relevant):\n${lines}`;
}

export default { list, add, update, remove, clearAll, recall, contextBlock, touchUsed };
