/**
 * Tests for the Global Search pure core (globalSearchCore): safe parameterized LIKE-query
 * construction (the user term never lands in the SQL string), snippet redaction of secrets +
 * control chars, ranking, and the security invariant that the searchable surface excludes the
 * vault/auth/audit tables and every source opens a real shell route. No DB. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import gs, { SEARCH_SOURCES, buildLikeQuery, escapeLike, redactSnippet, cleanTitle, rankResults } from '../electron/services/globalSearchCore';
import ui from '../src/lib/uiCore';

test('search surface excludes the vault/auth/audit and opens only real routes', () => {
  const tables = SEARCH_SOURCES.map((s) => s.table);
  for (const forbidden of ['vault_items', 'vault_key_metadata', 'auth_config', 'totp_backup_codes', 'tool_audit', 'prompt_security_events', 'auth_audit', 'email_audit', 'email_accounts'])
    assert.ok(!tables.includes(forbidden), `Global Search must never query ${forbidden}`);
  for (const s of SEARCH_SOURCES) assert.ok(ui.ROUTE_KEYS.includes(s.route), `source ${s.type} route '${s.route}' is not a real route`);
});

test('buildLikeQuery is parameterized — the term never appears in the SQL string', () => {
  const src = SEARCH_SOURCES.find((s) => s.type === 'note')!;
  const { sql, params } = buildLikeQuery(src, "Robert'); DROP TABLE notes;--", 8);
  assert.ok(!sql.includes('DROP TABLE'), 'user term must not be concatenated into SQL');
  assert.ok(/LIKE \? ESCAPE/.test(sql), 'must use parameterized LIKE with ESCAPE');
  assert.equal(params.length, 2, 'note has title+snippet → 2 bound params');
  assert.ok(params.every((p) => p.includes('%')), 'params are %term% bounded');
  assert.match(sql, /archived=0/, 'extraWhere applied');
  assert.match(sql, /LIMIT 8/);
});

test('buildLikeQuery clamps the limit and handles single-column sources', () => {
  const src = SEARCH_SOURCES.find((s) => s.type === 'conversation')!; // title only
  const { sql, params } = buildLikeQuery(src, 'hello', 9999);
  assert.equal(params.length, 1);
  assert.match(sql, /LIMIT 50/, 'limit clamped to 50');
});

test('escapeLike escapes wildcards so they match literally', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
});

test('redactSnippet masks secrets, strips control chars, truncates', () => {
  assert.ok(!redactSnippet('my key sk-ABCDEFGHIJKLMNOPQRSTUV here').includes('sk-ABCDEFGHIJKLMNOPQRSTUV'));
  assert.ok(!redactSnippet('token ntn_ABCDEFGHIJKLMNOPQRST').includes('ntn_ABCDEFGHIJKLMNOPQRST'));
  assert.ok(!redactSnippet('password: hunter2longvalue').includes('hunter2longvalue'));
  assert.ok(redactSnippet('a'.repeat(300)).length <= 140);
  assert.equal(cleanTitle(''), 'Untitled');
});

test('rankResults puts title matches ahead of snippet-only matches', () => {
  const mk = (title: string): any => ({ type: 't', label: 'T', id: title, title, snippet: '', route: 'notes' });
  const ranked = rankResults([mk('zzz mango'), mk('mango'), mk('mangosteen')], 'mango');
  assert.equal(ranked[0].title, 'mango', 'exact match first');
  assert.equal(ranked[1].title, 'mangosteen', 'prefix before contains');
});
