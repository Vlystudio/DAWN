/**
 * Tests for helper performance analytics (helperAnalyticsCore.ts) — pure, no electron, no model. Guards
 * the privacy + correctness contract: records ONLY safe metadata (never prompt/response/chunk/source
 * text/paths), bounded rolling buffer, correct per-role metrics + p50/p95, honest health labels (never
 * below the minimum sample), reset, and a safe snapshot/export. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { HelperAnalytics, statusFor } from '../electron/services/rag/helperAnalyticsCore';

const SAFE_KEYS = ['ts', 'role', 'provider', 'status', 'queueWaitMs', 'runMs', 'totalLatencyMs', 'reason', 'generation'];

test('record stores ONLY safe fields — no prompt/response/chunk/path can exist', () => {
  const a = new HelperAnalytics();
  const ev = a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', queueWaitMs: 5, runMs: 40, reason: 'ok', generation: 3 } as any);
  for (const k of Object.keys(ev)) assert.ok(SAFE_KEYS.includes(k), `unexpected field ${k}`);
  assert.equal(ev.totalLatencyMs, 45);
  // even if a caller passes junk text fields, they are NOT stored (record only reads the whitelist)
  const ev2 = a.record({ role: 'hyde_generator', provider: 'chat', status: 'fallback_used', prompt: 'SECRET PROMPT', response: 'SECRET RESPONSE', chunk: 'PRIVATE CHUNK' } as any);
  const json = JSON.stringify(a.snapshot('9.9'));
  assert.ok(!/SECRET|PRIVATE/.test(json), 'no private text may appear in the analytics snapshot/export');
  assert.ok(!('prompt' in ev2) && !('response' in ev2) && !('chunk' in ev2));
});

test('records every outcome type (completed/cancelled/timeout/superseded/unavailable/fallback/lexical)', () => {
  const a = new HelperAnalytics();
  a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed' });
  a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'cancelled' });
  a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'timeout' });
  a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'superseded' });
  a.record({ role: 'query_rewriter', provider: 'none', status: 'unavailable' });
  a.record({ role: 'query_rewriter', provider: 'chat', status: 'fallback_used' });
  a.record({ role: 'entailment_verifier', provider: 'lexical', status: 'fallback_used' });
  const m = a.roleMetrics('query_rewriter');
  assert.equal(m.jobs, 6);
  assert.equal(m.completed, 1); assert.equal(m.cancelled, 1); assert.equal(m.timeout, 1); assert.equal(m.superseded, 1);
  assert.equal(m.unavailableOrSkipped, 1); assert.equal(m.fallback, 1);
});

test('rolling buffer truncates to capacity (no unbounded growth)', () => {
  const a = new HelperAnalytics(50); // clamped min is 50
  for (let i = 0; i < 200; i++) a.record({ role: 'hyde_generator', provider: 'helper_runtime', status: 'completed', runMs: i });
  assert.equal(a.size(), 50);
});

test('p50/p95 compute correctly (nearest-rank)', () => {
  const a = new HelperAnalytics();
  for (let i = 1; i <= 10; i++) a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', queueWaitMs: 0, runMs: i * 100 });
  const m = a.roleMetrics('query_rewriter');
  assert.equal(m.p50TotalMs, 600); // sorted[floor(0.5*10)=5] = 600
  assert.equal(m.p95TotalMs, 1000); // sorted[floor(0.95*10)=9] = 1000
  assert.equal(m.successRate, 1);
});

test('health: insufficient data below the minimum sample', () => {
  const a = new HelperAnalytics();
  for (let i = 0; i < 5; i++) a.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', runMs: 10 });
  assert.equal(a.roleMetrics('query_rewriter').health, 'insufficient_data');
});
test('health: slow / timeout_prone / mostly_unavailable only after enough samples', () => {
  const slow = new HelperAnalytics();
  for (let i = 0; i < 8; i++) slow.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', runMs: 5000 });
  assert.equal(slow.roleMetrics('query_rewriter').health, 'slow');

  const to = new HelperAnalytics();
  for (let i = 0; i < 5; i++) to.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', runMs: 50 });
  for (let i = 0; i < 3; i++) to.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'timeout', runMs: 50 });
  assert.equal(to.roleMetrics('query_rewriter').health, 'timeout_prone');

  const un = new HelperAnalytics();
  for (let i = 0; i < 3; i++) un.record({ role: 'query_rewriter', provider: 'helper_runtime', status: 'completed', runMs: 50 });
  for (let i = 0; i < 5; i++) un.record({ role: 'query_rewriter', provider: 'none', status: 'unavailable' });
  assert.equal(un.roleMetrics('query_rewriter').health, 'mostly_unavailable');
});

test('global summary + hints are honest; reset clears session data', () => {
  const a = new HelperAnalytics();
  for (let i = 0; i < 8; i++) a.record({ role: 'hyde_generator', provider: 'helper_runtime', status: 'completed', runMs: 6000 });
  const g = a.global();
  assert.equal(g.slowestRole, 'hyde_generator');
  assert.ok(g.slowestP95Ms >= 4000);
  assert.ok(a.hints().some((h) => /HyDE helper is slow/.test(h)));
  a.reset();
  assert.equal(a.size(), 0);
  assert.equal(a.global().totalJobs, 0);
  assert.ok(a.hints()[0].includes('Not enough data'));
});

test('statusFor maps routing outcomes honestly (fallback vs failure vs cancel/timeout)', () => {
  assert.equal(statusFor('none', false), 'unavailable');
  assert.equal(statusFor('lexical', true), 'fallback_used');
  assert.equal(statusFor('chat', true), 'fallback_used');
  assert.equal(statusFor('chat', false), 'failed');
  assert.equal(statusFor('helper_runtime', true), 'completed');
  assert.equal(statusFor('helper_runtime', false, 'timeout'), 'timeout');
  assert.equal(statusFor('helper_runtime', false, 'superseded'), 'superseded');
  assert.equal(statusFor('helper_runtime', false, 'rejected'), 'failed');
});
