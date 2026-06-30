/**
 * Tests for the pure UI shell helpers (src/lib/uiCore): the canonical route map, risk/status
 * badge mapping, the Dashboard summary shaper (safe on empty; never embeds bodies/secrets), and
 * the RESTORE confirmation helper. No React. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import ui from '../src/lib/uiCore';

// (1) sidebar route list renders expected major routes
test('ROUTES include every major screen, grouped', () => {
  for (const k of ['dashboard', 'chat', 'explorer', 'research', 'hub', 'optimizer', 'compare', 'models', 'documents', 'notes', 'tasks', 'calendar', 'email', 'skills', 'security', 'backup', 'settings'])
    assert.ok(ui.ROUTE_KEYS.includes(k), `missing route ${k}`);
  assert.equal(ui.isKnownRoute('chat'), true);
  assert.equal(ui.isKnownRoute('nonsense'), false);
  // groups present
  const groups = new Set(ui.ROUTES.map((r) => r.group));
  for (const g of ['Core', 'Models', 'Workspace', 'Security', 'System']) assert.ok(groups.has(g), `missing group ${g}`);
});

// (3) risk badge mapping covers all levels; critical/high stand out, color not the only signal (label text)
test('badge/riskBadge map every level + status with a label', () => {
  for (const lvl of ['safe', 'low', 'medium', 'high', 'critical', 'disabled', 'locked', 'encrypted', 'ok', 'warning', 'error']) {
    const b = ui.badge(lvl);
    assert.ok(b.cls && b.dot && b.label, `badge ${lvl} incomplete`);
  }
  assert.match(ui.riskBadge('critical').cls, /neural-red/);
  assert.match(ui.riskBadge('safe').cls, /neural-green/);
  assert.match(ui.riskBadge('locked').cls, /amber/);
  assert.match(ui.riskBadge('encrypted').cls, /cyan/);
  // unknown → disabled fallback (never throws)
  assert.equal(ui.badge('???').label, 'disabled');
});

// (2) dashboard summary handles empty state safely
test('buildDashboardSummary is safe on empty data', () => {
  const s = ui.buildDashboardSummary();
  assert.equal(s.online, false);
  assert.equal(s.model, '');
  assert.deepEqual(s.upcoming, []);
  assert.deepEqual(s.recentDocs, []);
  assert.equal(s.counts.tasks, 0);
  assert.equal(s.counts.overdue, 0);
  assert.equal(s.security.mode, 'Local desktop');
  assert.equal(s.backup.has, false);
  assert.equal(s.email.accounts, 0);
});

test('dashboard summary shapes data without leaking bodies', () => {
  const now = Date.now();
  const s = ui.buildDashboardSummary({
    runtime: { state: 'READY', model: 'C:/models/Qwen2.5-7B.gguf', backend: 'Vulkan' },
    auth: { authEnabled: true, locked: false, totpEnabled: true } as any,
    tasks: [{ id: 't1', title: 'Pay invoice', due_at: now - 1000, status: 'todo', overdue: true }, { id: 't2', title: 'Call vet', due_at: now + 86400000, status: 'todo' }],
    documents: [{ id: 'd1', title: 'Spec', content: 'SECRET BODY should not appear' }],
    backups: [{ kind: 'backup', created_at: now }],
    emailAccounts: [{ lastSyncStatus: 'ok' }],
    promptEvents: 2,
  });
  assert.equal(s.online, true);
  assert.equal(s.model, 'Qwen2.5-7B.gguf');        // basename only
  assert.equal(s.counts.overdue, 1);
  assert.equal(s.upcoming[0].title, 'Pay invoice'); // earliest first
  assert.equal(s.security.mode, 'Secure');
  assert.equal(s.security.tone, 'safe');            // totp on
  assert.equal(s.backup.has, true);
  assert.equal(s.email.accounts, 1);
  assert.ok(!JSON.stringify(s).includes('SECRET BODY'), 'document body never enters the summary');
});

// (6) restore confirmation helper requires the exact word
test('isRestoreConfirmed requires exactly RESTORE', () => {
  assert.equal(ui.isRestoreConfirmed('RESTORE'), true);
  assert.equal(ui.isRestoreConfirmed(' RESTORE '), true);
  assert.equal(ui.isRestoreConfirmed('restore'), false);
  assert.equal(ui.isRestoreConfirmed('RESTOR'), false);
  assert.equal(ui.isRestoreConfirmed(''), false);
});
