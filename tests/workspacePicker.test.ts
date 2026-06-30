/**
 * Tests for the Workspace item picker / linking backend: the pure search-SQL builder (parameterized,
 * filters, excludeId, no injection) used by the picker, plus link validation (self/invalid blocked)
 * and the new System Health "Workspace Linking UX" area. No DB. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import wc, { buildWorkspaceSearchSql, validateLink } from '../electron/services/workspace/workspaceCore';
import fm from '../electron/services/featureMaturityCore';

test('picker search SQL is parameterized; term never concatenated', () => {
  const { sql, params } = buildWorkspaceSearchSql({ q: "x'; DROP TABLE workspace_items;--", limit: 40 });
  assert.ok(!sql.includes('DROP TABLE'), 'term must be bound, not concatenated');
  assert.match(sql, /label LIKE \? ESCAPE/);
  assert.equal(params.length, 1);
  assert.ok(params[0].includes('%'));
  assert.match(sql, /LIMIT 40/);
});

test('picker filters: type, source feature, excludeId, link type', () => {
  const { sql, params } = buildWorkspaceSearchSql({ type: 'note', sourceFeature: 'notes', excludeId: 'i1', linkType: 'related_to' });
  assert.match(sql, /type=\?/);
  assert.match(sql, /source_feature=\?/);
  assert.match(sql, /id != \?/, 'excludeId hides the source item');
  assert.match(sql, /workspace_links WHERE type=\?/, 'link-type filter via subquery');
  assert.ok(params.includes('note') && params.includes('notes') && params.includes('i1') && params.includes('related_to'));
  // invalid type is ignored (not injected)
  const bad = buildWorkspaceSearchSql({ type: 'bogus' });
  assert.ok(!/type=\?/.test(bad.sql), 'unknown item type is not filtered');
});

test('limit clamps to [1,200]; empty query selects all', () => {
  assert.match(buildWorkspaceSearchSql({ limit: 99999 }).sql, /LIMIT 200/);
  const all = buildWorkspaceSearchSql({});
  assert.ok(!all.sql.includes('WHERE'));
});

test('linking blocks self-links and invalid types (picker dialog relies on this)', () => {
  assert.equal(validateLink({ fromId: 'a', toId: 'a', type: 'related_to' }).ok, false);
  assert.equal(validateLink({ fromId: 'a', toId: 'b', type: 'nope' }).ok, false);
  assert.equal(validateLink({ fromId: 'a', toId: 'b', type: 'references' }).ok, true);
});

test('System Health: Workspace Linking UX area is COMPLETE', () => {
  assert.equal(fm.evaluateArea('workspace_linking').status, 'COMPLETE');
});
