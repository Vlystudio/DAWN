/**
 * Tests for the central status/badge mapper (src/lib/statusMap). It's the one source of truth for
 * status language, so it must: map every documented status in each group to a valid badge tone +
 * label + explanation, resolve unknown codes safely to a neutral "Unknown" (never throw), use only
 * real badge tones (uiCore BadgeKind), and have no duplicate keys within a group. No React.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import sm, { resolveStatus, statusLabel, statusTone, STATUS_GROUPS } from '../src/lib/statusMap';
import ui from '../src/lib/uiCore';
import fm from '../electron/services/featureMaturityCore';

const VALID_TONES = new Set(['safe', 'low', 'medium', 'high', 'critical', 'disabled', 'locked', 'encrypted', 'ok', 'warning', 'error']);

test('every status in every group has a valid tone (real badge), label, and explanation', () => {
  for (const [group, map] of Object.entries(STATUS_GROUPS)) {
    for (const [key, def] of Object.entries(map)) {
      assert.ok(def.label && def.explain, `${group}.${key} missing label/explain`);
      assert.ok(VALID_TONES.has(def.tone), `${group}.${key} tone '${def.tone}' is not a badge tone`);
      assert.ok(ui.badge(def.tone).label !== undefined, `${group}.${key} tone must resolve in uiCore.badge`);
    }
  }
});

test('the documented groups + key statuses are present', () => {
  assert.equal(resolveStatus('feature', 'COMPLETE').label, 'Complete');
  assert.equal(resolveStatus('feature', 'BLOCKED_BY_SETUP').label, 'Needs setup');
  assert.equal(resolveStatus('knowledge', 'stale').tone, 'warning');
  assert.equal(resolveStatus('knowledge', 'failed').tone, 'error');
  assert.equal(resolveStatus('modelFit', 'Fits in VRAM').tone, 'ok');
  assert.equal(resolveStatus('modelFit', 'Too large / not recommended').tone, 'error');
  assert.equal(resolveStatus('toolRisk', 'critical').tone, 'critical');
  assert.equal(resolveStatus('setup', 'READY').tone, 'ok');
  assert.equal(resolveStatus('retrieval', 'keyword fallback').tone, 'warning');
});

test('unknown codes resolve to a safe neutral Unknown (never throw / never fake)', () => {
  assert.equal(resolveStatus('feature', 'NONSENSE').label, 'Unknown');
  assert.equal(resolveStatus('feature', 'NONSENSE').tone, 'disabled');
  assert.equal(resolveStatus('knowledge', undefined as any).tone, 'disabled');
  assert.equal(resolveStatus('badGroup' as any, 'x').label, 'Unknown');
  assert.equal(statusLabel('feature', null as any), 'Unknown');
  assert.equal(statusTone('modelFit', ''), 'disabled');
});

test('no duplicate canonical keys within a group (key === def.key)', () => {
  for (const [group, map] of Object.entries(STATUS_GROUPS)) {
    for (const [key, def] of Object.entries(map)) assert.equal(def.key, key, `${group} key/def mismatch for ${key}`);
  }
});

test('System Health: Status Language is COMPLETE; Design System stays PARTIAL', () => {
  assert.equal(fm.evaluateArea('status_language').status, 'COMPLETE');
  assert.equal(fm.evaluateArea('design_system').status, 'PARTIAL');
});
