/**
 * Tests for live workspace hooks: the System Health area is honestly PARTIAL (notes/tasks hooked,
 * others reconcile-only), and the remove-by-ref SQL contract (used by live deletes) removes exactly
 * the right item + its links without touching others. No electron. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fm from '../electron/services/featureMaturityCore';
import { ADAPTER_DEFS } from '../electron/services/workspace/adaptersCore';

test('Live Workspace Hooks is honestly PARTIAL and lists reconcile-only features', () => {
  const r = fm.evaluateArea('workspace_livehooks');
  assert.equal(r.status, 'PARTIAL');
  assert.ok(r.works.some((w) => /Notes.*Tasks.*Documents.*Memories/.test(w)), 'lists the hooked features');
  assert.ok(r.works.some((w) => /Knowledge/i.test(w)), 'Knowledge is now live-hooked');
  assert.ok(r.works.some((w) => /name only, no path/i.test(w)), 'knowledge hook stays name-only (no path/content leak)');
  assert.ok(r.works.some((w) => /Benchmarks/i.test(w)), 'Benchmarks is now live-hooked');
  assert.ok(r.works.some((w) => /public model name only/i.test(w)), 'benchmark hook registers the public model name only');
  assert.ok(r.missing.some((m) => /reconcile-only/i.test(m)), 'must list what is still reconcile-only');
  assert.ok(!r.missing.some((m) => /Knowledge/i.test(m)), 'Knowledge is no longer in the reconcile-only list');
  assert.ok(!r.missing.some((m) => /Benchmark/i.test(m)), 'Benchmarks is no longer in the reconcile-only list');
});

test('Knowledge live hook matches the reconcile adapter (no drift, no double-registration)', () => {
  // rag.ts calls live.register('knowledge_source', id, name, 'knowledge'). That MUST equal the
  // reconcile adapter's identity for knowledge, or live + reconcile would create divergent items.
  const def = ADAPTER_DEFS.find((d) => d.feature === 'knowledge');
  assert.ok(def, 'a knowledge reconcile adapter exists');
  assert.equal(def!.type, 'knowledge_source', 'live hook type must equal the adapter type (dedupes by type+ref_id)');
  assert.equal(def!.feature, 'knowledge', 'live hook sourceFeature must equal the adapter feature');
  assert.deepEqual(def!.labelCols, ['name'], 'label is the name only — never the full path (privacy)');
  // The adapter excludes removed/skipped rows; the live hook prunes on exactly those transitions.
  assert.ok(/state IN \('indexed','stale'\)/.test(def!.extraWhere || ''), 'active states = indexed/stale (stale stays, removed/skipped pruned)');
});

test('Benchmark live hook matches the reconcile adapter (no drift, public label only)', () => {
  // benchmark.ts calls live.register('benchmark', id, name, 'benchmark') on run and live.remove on delete.
  const def = ADAPTER_DEFS.find((d) => d.feature === 'benchmark');
  assert.ok(def, 'a benchmark reconcile adapter exists');
  assert.equal(def!.type, 'benchmark', 'live hook type must equal the adapter type (dedupes by type+ref_id)');
  assert.equal(def!.feature, 'benchmark', 'live hook sourceFeature must equal the adapter feature');
  assert.deepEqual(def!.labelCols, ['model_name'], 'label is the public model name — no secrets');
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
