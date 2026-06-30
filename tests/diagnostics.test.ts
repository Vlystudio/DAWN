/**
 * Tests for the diagnostics redaction core (diagnosticsCore). The diagnostics export is a security
 * surface — it must never leak a secret. These tests verify settings secrets are blanked by key and
 * by value pattern, log lines are redacted, and the bundle/summary shape is sane. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import dc, { redactSettings, redactValue, redactLogLine, buildBundle, copySummary } from '../electron/services/diagnosticsCore';

test('redactSettings blanks secret-keyed values, keeps non-secret config', () => {
  const out = redactSettings({
    notionToken: 'ntn_REALsecret1234567890', companionPin: '246810', adminPassword: 'hunter2',
    openaiApiKey: 'sk-abcdefghijklmnop', totpSeed: 'JBSWY3DPEHPK3PXP',
    contextLength: 8192, ollamaUrl: 'http://localhost:11434', projects: ['A', 'B'],
  });
  for (const k of ['notionToken', 'companionPin', 'adminPassword', 'openaiApiKey', 'totpSeed'])
    assert.equal(out[k], '⟨redacted⟩', `${k} must be blanked`);
  assert.equal(out.contextLength, 8192, 'non-secret config preserved');
  assert.equal(out.ollamaUrl, 'http://localhost:11434');
  assert.deepEqual(out.projects, ['A', 'B']);
});

test('redactValue masks secret patterns embedded in arbitrary strings', () => {
  assert.ok(!redactValue('here is sk-ABCDEFGHIJKLMNOP and more').includes('sk-ABCDEFGHIJKLMNOP'));
  assert.ok(!redactValue('Authorization: Bearer abcdef0123456789').includes('abcdef0123456789'));
  assert.equal(redactValue(42), 42);
});

test('redactLogLine redacts secrets in a log message', () => {
  assert.ok(!redactLogLine('connecting with token ntn_ABCDEFGHIJKLMNOP').includes('ntn_ABCDEFGHIJKLMNOP'));
});

test('buildBundle produces a redacted, well-shaped object', () => {
  const b = buildBundle({
    app: { name: 'DAWN', version: '0.2.0' },
    system: { platform: 'win32' },
    settings: { notionToken: 'ntn_SECRETvalue1234567', contextLength: 4096 },
    logs: [{ ts: 1, level: 'info', source: 'x', message: 'pass token sk-ABCDEFGHIJKLMNOP' }],
    errors: ['boom with ntn_ABCDEFGHIJKLMNOP'],
    health: { completionPct: 70, total: 38, byStatus: { COMPLETE: 20, BROKEN: 0, MISSING: 2 } as any },
  });
  assert.equal(b.settings.notionToken, '⟨redacted⟩');
  assert.equal(b.settings.contextLength, 4096);
  assert.ok(!JSON.stringify(b).includes('sk-ABCDEFGHIJKLMNOP'), 'no secret survives in the serialized bundle');
  assert.ok(!JSON.stringify(b).includes('ntn_ABCDEFGHIJKLMNOP'));
  assert.ok(b.generatedAt && b.note);
});

test('copySummary is a short, secret-free triage string', () => {
  const b = buildBundle({ app: { version: '0.2.0' }, system: { platform: 'win32' }, runtime: { state: 'READY', backend: 'Vulkan' }, health: { completionPct: 70, byStatus: { BROKEN: 1, MISSING: 2 } as any, total: 38 }, errors: ['something failed'] });
  const sum = copySummary(b);
  assert.match(sum, /DAWN 0\.2\.0/);
  assert.match(sum, /READY/);
  assert.match(sum, /70%/);
  assert.match(sum, /something failed/);
});
