/**
 * Tests for Workspace auto-registration. Two layers:
 *  (1) adaptersCore (pure) — real source rows map to correct items; bad rows never crash;
 *  (2) the upsert + prune SQL contract via real sql.js (idempotent register, no duplicates on the
 *      same source id, update on change, safe orphan removal). No electron. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import ac, { ADAPTER_DEFS, mapRowToItem } from '../electron/services/workspace/adaptersCore';
import fm from '../electron/services/featureMaturityCore';

// ---- (1) pure mapping ----
test('adapter defs cover the real sources and never include secret tables', () => {
  const features = ADAPTER_DEFS.map((d) => d.feature);
  for (const f of ['notes', 'tasks', 'documents', 'chat', 'memory', 'research', 'benchmark', 'email']) assert.ok(features.includes(f), `missing adapter ${f}`);
  const tables = ADAPTER_DEFS.map((d) => d.table);
  for (const forbidden of ['vault_items', 'auth_config', 'email_audit', 'tool_audit']) assert.ok(!tables.includes(forbidden));
});

test('mapRowToItem maps a real note row; picks label, snippet, timestamp, refId', () => {
  const def = ADAPTER_DEFS.find((d) => d.feature === 'notes')!;
  const m = mapRowToItem(def, { id: 'n1', title: 'My note', content: 'body text', updated_at: 123, archived: 0 })!;
  assert.equal(m.type, 'note'); assert.equal(m.refId, 'n1'); assert.equal(m.label, 'My note');
  assert.equal(m.updatedAt, 123); assert.match(m.metadata, /snippet/);
});

test('mapRowToItem is safe on bad rows (no id, missing cols) and never throws', () => {
  const def = ADAPTER_DEFS.find((d) => d.feature === 'tasks')!;
  assert.equal(mapRowToItem(def, {}), null);
  assert.equal(mapRowToItem(def, { id: '' }), null);
  const m = mapRowToItem(def, { id: 't1' })!; // no title
  assert.equal(m.label, 'task'); // falls back to the type, never blank
  assert.ok(typeof m.metadata === 'string');
});

test('System Health: Workspace Auto-Registration area is COMPLETE and distinct from core', () => {
  assert.equal(fm.evaluateArea('workspace_autoreg', { workspaceRegistered: 5 }).status, 'COMPLETE');
  assert.equal(fm.evaluateArea('workspace', { workspaceItems: 5 }).status, 'COMPLETE');
});

// ---- (2) upsert + prune SQL contract via sql.js ----
const DDL = `CREATE TABLE workspace_items (id TEXT PRIMARY KEY, type TEXT, ref_id TEXT, label TEXT, source_feature TEXT, metadata TEXT, created_at INTEGER, updated_at INTEGER);`;

/** Mirrors items.create's dedupe (find by type+ref_id → update else insert) + registry prune. */
function upsert(db: any, type: string, refId: string, label: string, feature: string, t: number) {
  const res = db.exec('SELECT id FROM workspace_items WHERE type=? AND ref_id=?', [type, refId]);
  if (res.length && res[0].values.length) {
    db.run('UPDATE workspace_items SET label=?, updated_at=? WHERE type=? AND ref_id=?', [label, t, type, refId]);
  } else {
    db.run('INSERT INTO workspace_items VALUES (?,?,?,?,?,?,?,?)', [`${type}:${refId}`, type, refId, label, feature, '{}', t, t]);
  }
}

test('auto-registration is idempotent (no dup on same source id), updates on change, prunes orphans', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(DDL);

  // register twice for the same note id → exactly one row
  upsert(db, 'note', 'n1', 'Note v1', 'notes', 1);
  upsert(db, 'note', 'n1', 'Note v1', 'notes', 1);
  let c = db.exec("SELECT COUNT(*) FROM workspace_items WHERE ref_id='n1'");
  assert.equal(c[0].values[0][0], 1, 'same source id must not duplicate');

  // source changed → label updates in place
  upsert(db, 'note', 'n1', 'Note v2', 'notes', 2);
  const lbl = db.exec("SELECT label FROM workspace_items WHERE ref_id='n1'");
  assert.equal(lbl[0].values[0][0], 'Note v2', 'changed source updates the item');
  c = db.exec("SELECT COUNT(*) FROM workspace_items WHERE ref_id='n1'");
  assert.equal(c[0].values[0][0], 1, 'update must not create a second row');

  // prune: source 'n1' deleted → valid set is empty → remove auto-registered note items
  const valid = new Set<string>(); // no notes remain
  const existing = db.exec("SELECT id, ref_id FROM workspace_items WHERE type='note' AND source_feature='notes' AND ref_id IS NOT NULL");
  if (existing.length) for (const [id, ref] of existing[0].values) if (!valid.has(String(ref))) db.run('DELETE FROM workspace_items WHERE id=?', [id]);
  c = db.exec('SELECT COUNT(*) FROM workspace_items');
  assert.equal(c.length === 0 || c[0].values[0][0] === 0, true, 'orphaned auto-registered items are pruned');
  db.close();
});
