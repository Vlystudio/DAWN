/**
 * Route consistency — guards the cohesion invariants of the shell: no duplicate route ids/keys, the
 * sidebar route list matches the canonical uiCore ROUTES, and every System Health area + every
 * Workspace/search source opens a route that actually exists (no dead links). Pure; no React.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import ui from '../src/lib/uiCore';
import fm, { FEATURE_AREAS } from '../electron/services/featureMaturityCore';
import { SEARCH_SOURCES } from '../electron/services/globalSearchCore';

test('no duplicate route keys; ROUTE_KEYS matches ROUTES', () => {
  const keys = ui.ROUTES.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate route key in ROUTES');
  assert.deepEqual(ui.ROUTE_KEYS, keys);
});

test('every route is in a known group; no orphan groups', () => {
  const groups = new Set(['Home', 'Core', 'Models', 'Workspace', 'Knowledge', 'Automation', 'Security', 'System']);
  for (const r of ui.ROUTES) assert.ok(groups.has(r.group), `route ${r.key} has unknown group ${r.group}`);
});

test('all System Health area routes resolve to real shell routes (no dead links)', () => {
  for (const a of FEATURE_AREAS) {
    if (a.route) assert.ok(ui.isKnownRoute(a.route), `area ${a.id} -> dead route ${a.route}`);
    if (a.settingsRoute) assert.ok(ui.isKnownRoute(a.settingsRoute), `area ${a.id} -> dead settingsRoute ${a.settingsRoute}`);
  }
});

test('every Global Search source opens a real route', () => {
  for (const s of SEARCH_SOURCES) assert.ok(ui.isKnownRoute(s.route), `search source ${s.type} -> dead route ${s.route}`);
});

test('the new cohesion routes exist (workspace, setup, health)', () => {
  for (const k of ['workspace', 'setup', 'health']) assert.ok(ui.isKnownRoute(k), `missing route ${k}`);
});
