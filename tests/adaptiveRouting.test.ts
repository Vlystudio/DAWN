/**
 * Tests for adaptive helper routing (adaptiveRoutingCore.ts) — pure, deterministic, no electron/model.
 * Guards the honest contract: off = manual behaviour, never routes away below the minimum sample, routes
 * away only on measured slow/timeout/failure, cooldown prevents immediate route-back, recovery needs
 * enough healthy samples (one good sample never restores), and everything is reversible. Evidence is
 * numbers only — no private text. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import core, { decide, appliesTo } from '../electron/services/rag/adaptiveRoutingCore';

const NOW = 1_000_000;
const CFG = (over: any = {}) => ({
  enabled: true, minSamples: 12, slowP95Ms: 3500, timeoutRateThreshold: 0.20, failureRateThreshold: 0.30,
  cooldownMs: 300000, recoveryMinSamples: 8, recoveryP95Ms: 2000, recoveryTimeoutRate: 0.10,
  applyToRewrite: true, applyToHyDE: true, applyToEntailment: true, ...over,
});
const ST = (over: any = {}) => ({ status: 'active', routedAwayAt: 0, lastRecoveryAt: 0, lastProbeAt: 0, ...over });
const FULL = (over: any = {}) => ({ jobs: 20, p95Ms: 1000, timeoutRate: 0, failureRate: 0, health: 'healthy', ...over });
const WIN = (over: any = {}) => ({ jobs: 0, p95Ms: 0, timeoutRate: 0, ...over });
const R = 'query_rewriter' as const;

test('disabled → manual/keep-helper behaviour (beta.25)', () => {
  const d = decide(R, CFG({ enabled: false }), ST(), FULL(), WIN(), NOW);
  assert.equal(d.decision.decisionType, 'disabled');
  assert.equal(d.decision.preferHelper, true);
});

test('per-role toggle off → manual (no adaptive for that role); appliesTo maps roles', () => {
  const d = decide(R, CFG({ applyToRewrite: false }), ST(), FULL({ p95Ms: 9999 }), WIN(), NOW);
  assert.equal(d.decision.decisionType, 'manual');
  assert.equal(d.decision.preferHelper, true);
  assert.equal(appliesTo(CFG({ applyToHyDE: false }), 'hyde_generator'), false);
  assert.equal(appliesTo(CFG(), 'entailment_verifier'), true);
});

test('insufficient samples never routes away; healthy keeps helper', () => {
  const few = decide(R, CFG(), ST(), FULL({ jobs: 5, p95Ms: 9999 }), WIN(), NOW);
  assert.equal(few.decision.decisionType, 'insufficient_data');
  assert.equal(few.decision.preferHelper, true);
  assert.equal(few.nextState.status, 'active');
  const ok = decide(R, CFG(), ST(), FULL(), WIN(), NOW);
  assert.equal(ok.decision.decisionType, 'adaptive_helper_allowed');
  assert.equal(ok.decision.preferHelper, true);
});

test('routes away on slow p95 / high timeout / high failure (over min samples)', () => {
  const slow = decide(R, CFG(), ST(), FULL({ p95Ms: 4000 }), WIN(), NOW);
  assert.equal(slow.decision.decisionType, 'adaptive_avoid_slow_helper');
  assert.equal(slow.decision.preferHelper, false);
  assert.equal(slow.decision.routedAwayFromHelper, true);
  assert.equal(slow.nextState.status, 'away');
  assert.equal(slow.nextState.routedAwayAt, NOW);

  assert.equal(decide(R, CFG(), ST(), FULL({ timeoutRate: 0.3 }), WIN(), NOW).decision.decisionType, 'adaptive_avoid_timeout_prone_helper');
  assert.equal(decide(R, CFG(), ST(), FULL({ failureRate: 0.4 }), WIN(), NOW).decision.decisionType, 'adaptive_avoid_failure_prone_helper');
});

test('cooldown prevents immediate route-back (stays away while cooldown remains)', () => {
  const st = ST({ status: 'away', routedAwayAt: NOW - 1000 }); // 1s ago, cooldown 300s
  const d = decide(R, CFG(), st, FULL({ p95Ms: 500 }), WIN(), NOW); // even if metrics look good now
  assert.equal(d.decision.preferHelper, false);
  assert.ok(d.decision.evidence.cooldownRemainingMs > 0);
  assert.equal(d.nextState.status, 'away');
});

test('after cooldown → recovery probe (helper allowed to gather fresh samples)', () => {
  const st = ST({ status: 'away', routedAwayAt: NOW - 400000 }); // past cooldown
  const d = decide(R, CFG(), st, FULL(), WIN(), NOW);
  assert.equal(d.decision.decisionType, 'adaptive_recovery_probe');
  assert.equal(d.decision.preferHelper, true);
  assert.equal(d.decision.recoveryProbe, true);
  assert.equal(d.nextState.status, 'probing');
});

test('probing: one good sample does NOT restore; needs recoveryMinSamples', () => {
  const st = ST({ status: 'probing', routedAwayAt: NOW - 500000 });
  const one = decide(R, CFG(), st, FULL(), WIN({ jobs: 1, p95Ms: 100, timeoutRate: 0 }), NOW);
  assert.equal(one.decision.decisionType, 'adaptive_recovery_probe'); // still probing
  assert.equal(one.nextState.status, 'probing');
});

test('probing → recovered when window is healthy over enough samples (routes back)', () => {
  const st = ST({ status: 'probing', routedAwayAt: NOW - 500000 });
  const rec = decide(R, CFG(), st, FULL(), WIN({ jobs: 10, p95Ms: 1500, timeoutRate: 0.05 }), NOW);
  assert.equal(rec.decision.decisionType, 'adaptive_helper_allowed');
  assert.equal(rec.decision.preferHelper, true);
  assert.equal(rec.decision.routedBackToHelper, true);
  assert.equal(rec.nextState.status, 'active');
});

test('probing → still bad re-routes away (reset cooldown), no flapping', () => {
  const st = ST({ status: 'probing', routedAwayAt: NOW - 500000 });
  const still = decide(R, CFG(), st, FULL(), WIN({ jobs: 10, p95Ms: 3000, timeoutRate: 0.05 }), NOW);
  assert.equal(still.decision.preferHelper, false);
  assert.equal(still.nextState.status, 'away');
  assert.equal(still.nextState.routedAwayAt, NOW);
});

test('evidence carries numbers only — no private text fields', () => {
  const d = decide(R, CFG(), ST(), FULL({ p95Ms: 4000, jobs: 25 }), WIN(), NOW);
  assert.deepEqual(Object.keys(d.decision.evidence).sort(), ['cooldownRemainingMs', 'failureRate', 'health', 'p95Ms', 'sampleCount', 'timeoutRate']);
  assert.ok(!/prompt|response|chunk|text/i.test(JSON.stringify(d.decision)));
  assert.equal(d.decision.reversible, true);
});
