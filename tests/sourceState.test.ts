/**
 * Tests for the Local Knowledge source lifecycle state machine (sourceStateCore): legal/illegal
 * transitions, active/searchable rules, legacy-NULL handling, the failure-message sanitizer (no path,
 * no secret, no contents), and the state roll-up. No DB. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import ss, { canTransition, isActive, effectiveState, sanitizeError, summarizeStates, SOURCE_STATES } from '../electron/services/knowledge/sourceStateCore';

test('legal lifecycle transitions are allowed; illegal ones are blocked', () => {
  assert.ok(canTransition('pending', 'validating'));
  assert.ok(canTransition('validating', 'indexing'));
  assert.ok(canTransition('validating', 'skipped'));
  assert.ok(canTransition('indexing', 'indexed'));
  assert.ok(canTransition('indexing', 'failed'));
  assert.ok(canTransition('indexed', 'stale'));
  assert.ok(canTransition('stale', 'indexing'));
  assert.ok(canTransition('failed', 'indexing'));
  assert.ok(canTransition('indexed', 'removed'));
  // illegal
  assert.equal(canTransition('indexed', 'pending'), false);
  assert.equal(canTransition('skipped', 'indexed'), false);
  assert.equal(canTransition('removed', 'indexed'), false);
  assert.equal(canTransition('bogus', 'indexed'), false);
});

test('removed/skipped are not active; legacy NULL state is treated as indexed', () => {
  assert.equal(isActive('indexed'), true);
  assert.equal(isActive('removed'), false);
  assert.equal(isActive('skipped'), false);
  assert.equal(effectiveState(null), 'indexed');
  assert.equal(effectiveState('failed'), 'failed');
});

test('sanitizeError strips absolute paths + secrets + contents and truncates', () => {
  const s1 = sanitizeError('Error reading C:\\Users\\me\\secret\\notes.txt: permission denied');
  assert.ok(!s1.includes('C:\\Users'), 'windows path removed');
  assert.match(s1, /permission denied/);
  const s2 = sanitizeError('failed: token sk-ABCDEFGHIJKLMNOP in /home/me/app/.env');
  assert.ok(!s2.includes('sk-ABCDEFGHIJKLMNOP'), 'secret masked');
  assert.ok(!s2.includes('/home/me/app'), 'unix path removed');
  assert.ok(sanitizeError('x'.repeat(500)).length <= 200);
  assert.equal(sanitizeError(''), 'Indexing failed.');
});

test('summarizeStates rolls up honestly (NULL counts as indexed)', () => {
  const sum = summarizeStates(['indexed', 'failed', null, 'indexed', 'skipped', 'stale']);
  assert.equal(sum.indexed, 3, 'two indexed + one legacy null');
  assert.equal(sum.failed, 1);
  assert.equal(sum.skipped, 1);
  assert.equal(sum.stale, 1);
  assert.equal(Object.values(sum).reduce((a, b) => a + b, 0), 6);
  assert.equal(SOURCE_STATES.length, 8);
});
