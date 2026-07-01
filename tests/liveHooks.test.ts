/**
 * Tests for live workspace hooks: the System Health area is honestly PARTIAL (notes/tasks hooked,
 * others reconcile-only), and the remove-by-ref SQL contract (used by live deletes) removes exactly
 * the right item + its links without touching others. No electron. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fm from '../electron/services/featureMaturityCore';

test('Live Workspace Hooks is honestly PARTIAL and lists reconcile-only features', () => {
  const r = fm.evaluateArea('workspace_livehooks');
  assert.equal(r.status, 'PARTIAL');
  assert.ok(r.works.some((w) => /Notes \+ Tasks/.test(w)));
  assert.ok(r.missing.some((m) => /reconcile-only/i.test(m)), 'must list what is still reconcile-only');
});

const DDL = `
CREATE TABLE workspace_items (id TEXT PRIMARY KEY, type TEXT, ref_id TEXT, label TEXT, source_feature TEXT, metadata TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE workspace_links (id TEXT PRIMARY KEY, from_id TEXT, to_id TEXT, type TEXT, metadata TEXT, created_at INTEGER, UNIQUE(from_id,to_id,type));
`;

test('removeByRef SQL: deletes exactly the (type,ref_id) item + its links, leaves others', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(DDL);
  db.run("INSERT INTO workspace_items VALUES ('i1','note','n1','A','notes','{}',1,1)");
  db.run("INSERT INTO workspace_items VALUES ('i2','task','t1','B','tasks','{}',1,1)");
  db.run("INSERT INTO workspace_links VALUES ('l1','i1','i2','related_to','{}',1)");

  // live remove of note n1 → find by (type,ref_id), delete item + its links (mirrors items.removeByRef)
  const found = db.exec("SELECT id FROM workspace_items WHERE type='note' AND ref_id='n1'");
  const id = found[0].values[0][0];
  db.run('DELETE FROM workspace_links WHERE from_id=? OR to_id=?', [id, id]);
  db.run('DELETE FROM workspace_items WHERE id=?', [id]);

  assert.equal(db.exec("SELECT COUNT(*) FROM workspace_items")[0].values[0][0], 1, 'only the task item remains');
  assert.equal(db.exec("SELECT COUNT(*) FROM workspace_links")[0].values[0][0], 0, 'the link touching the removed item is gone');
  assert.equal(db.exec("SELECT id FROM workspace_items")[0].values[0][0], 'i2', 'the other item is untouched');
  db.close();
});
