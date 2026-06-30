/**
 * Tests for the System Health / Feature Maturity pure core (featureMaturityCore). Verifies the
 * catalog is internally consistent (unique ids, real routes, no dead links into the shell), the
 * classifier is honest (setup-gated areas report BLOCKED_BY_SETUP, failing email reports BROKEN,
 * unimplemented areas report MISSING), and the roll-up summary is sane. No electron. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fm, { FEATURE_AREAS, evaluateArea, evaluateAll, summarizeReports, statusTone } from '../electron/services/featureMaturityCore';
import ui from '../src/lib/uiCore';

test('catalog has unique ids and every route maps to a real shell route (no dead links)', () => {
  const ids = FEATURE_AREAS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate feature area id');
  for (const a of FEATURE_AREAS) {
    if (a.route) assert.ok(ui.ROUTE_KEYS.includes(a.route), `area ${a.id} route '${a.route}' is not a known shell route`);
    if (a.settingsRoute) assert.ok(ui.ROUTE_KEYS.includes(a.settingsRoute), `area ${a.id} settingsRoute '${a.settingsRoute}' is not a known shell route`);
    assert.ok(a.name && a.group && a.summary, `area ${a.id} missing metadata`);
  }
});

test('statusTone maps every status to a valid uiCore badge kind', () => {
  for (const s of ['COMPLETE', 'PARTIAL', 'BLOCKED_BY_SETUP', 'STUB', 'BROKEN', 'MISSING'] as const) {
    const tone = statusTone(s);
    const b = ui.badge(tone);
    assert.ok(b && b.label, `tone for ${s} -> ${tone} is not a real badge`);
  }
});

test('evaluateArea is honest: setup-gated areas report BLOCKED_BY_SETUP when unconfigured', () => {
  assert.equal(evaluateArea('email', { emailAccounts: 0 }).status, 'BLOCKED_BY_SETUP');
  assert.equal(evaluateArea('security', { authEnabled: false }).status, 'BLOCKED_BY_SETUP');
  assert.equal(evaluateArea('obsidian', { obsidianConfigured: false }).status, 'BLOCKED_BY_SETUP');
  assert.equal(evaluateArea('notion', { notionConfigured: false }).status, 'BLOCKED_BY_SETUP');
  assert.equal(evaluateArea('models', { modelCount: 0 }).status, 'BLOCKED_BY_SETUP');
  // each carries a requiredSetup hint so the user isn't left guessing
  assert.ok(evaluateArea('email', { emailAccounts: 0 }).requiredSetup);
});

test('evaluateArea reflects real state when configured', () => {
  assert.equal(evaluateArea('email', { emailAccounts: 1, emailLastStatus: 'ok' }).status, 'COMPLETE');
  assert.equal(evaluateArea('email', { emailAccounts: 1, emailLastStatus: 'failed' }).status, 'BROKEN');
  assert.equal(evaluateArea('security', { authEnabled: true }).status, 'COMPLETE');
  assert.equal(evaluateArea('vault', { vaultItems: 3 }).status, 'COMPLETE');
  assert.equal(evaluateArea('chat', { runtimeInstalled: true, modelSelected: true }).status, 'COMPLETE');
  assert.equal(evaluateArea('chat', { runtimeInstalled: false, modelSelected: false }).status, 'BLOCKED_BY_SETUP');
  assert.equal(evaluateArea('totp', { authEnabled: true, totpEnabled: true }).status, 'COMPLETE');
  assert.equal(evaluateArea('totp', { authEnabled: false }).status, 'BLOCKED_BY_SETUP');
});

test('unimplemented areas report MISSING honestly; unknown id is MISSING', () => {
  assert.equal(evaluateArea('search', { globalSearch: false }).status, 'MISSING');
  assert.equal(evaluateArea('does-not-exist').status, 'MISSING');
});

test('palette flips MISSING -> COMPLETE once implemented; search stays honest', () => {
  assert.equal(evaluateArea('palette', { commandPalette: false }).status, 'MISSING');
  assert.equal(evaluateArea('palette', { commandPalette: true }).status, 'COMPLETE');
  assert.equal(evaluateArea('search', { globalSearch: false }).status, 'MISSING');
});

test('evaluateAll covers the whole catalog and summarize is sane', () => {
  const reports = evaluateAll({});
  assert.equal(reports.length, FEATURE_AREAS.length);
  const sum = summarizeReports(reports);
  assert.equal(sum.total, FEATURE_AREAS.length);
  assert.ok(sum.completionPct >= 0 && sum.completionPct <= 100);
  const counted = Object.values(sum.byStatus).reduce((a, b) => a + b, 0);
  assert.equal(counted, reports.length, 'every area must land in exactly one status bucket');
});

test('completion percentage rises as features become complete', () => {
  const empty = summarizeReports(evaluateAll({}));
  const rich = summarizeReports(evaluateAll({
    runtimeInstalled: true, modelSelected: true, modelCount: 3, benchmarkCount: 2, authEnabled: true,
    totpEnabled: true, vaultItems: 2, emailAccounts: 1, emailLastStatus: 'ok', backups: 1, notes: 5, tasks: 5,
    documents: 3, events: 2, researchRuns: 2, memories: 4, brainNodes: 20, skills: 2, toolsEnabled: true,
    indexedFolders: 1, knowledgeChunks: 50, obsidianConfigured: true, notionConfigured: true, voiceEnabled: true,
    companionEnabled: true, firstRunComplete: true, codingWorkspaces: 1, fileAgentEnabled: true,
  }));
  assert.ok(rich.completionPct > empty.completionPct, 'a configured app must score higher than an empty one');
});
