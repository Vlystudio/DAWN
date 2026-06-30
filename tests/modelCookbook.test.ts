/**
 * Tests for the Model Cookbook pure core (modelCookbookCore): role normalization, honest hardware-fit
 * labels (including Unknown hardware when VRAM isn't detected), recommended/slow/not-recommended
 * explanations, and best-per-role selection that never invents a model. No electron. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import mc, { normalizeRoles, fitLabel, isRecommended, explain, bestForRole, CookbookEntry } from '../electron/services/optimizer/modelCookbookCore';
import fm from '../electron/services/featureMaturityCore';

test('normalizeRoles maps aliases to canonical roles and drops unknowns', () => {
  assert.deepEqual(normalizeRoles(['chat', 'coder', 'reason']).sort(), ['coding', 'fast', 'reasoning']);
  assert.deepEqual(normalizeRoles(['embedding']), ['embeddings']);
  assert.deepEqual(normalizeRoles(['nonsense']), []);
  assert.deepEqual(normalizeRoles('vision'), ['vision']);
});

test('fitLabel reflects real compatibility and reports Unknown hardware honestly', () => {
  assert.equal(fitLabel('Excellent', true), 'Fits in VRAM');
  assert.equal(fitLabel('Good', true), 'Fits in VRAM');
  assert.equal(fitLabel('Borderline', true), 'Partial offload');
  assert.equal(fitLabel('CPU-only fallback', true), 'CPU fallback');
  assert.equal(fitLabel('Unsupported', true), 'Too large / not recommended');
  assert.equal(fitLabel('Excellent', false), 'Unknown hardware', 'no VRAM info => unknown, never a fake claim');
});

test('explanations are honest about why (recommended / slow / not / unknown)', () => {
  assert.match(explain({ level: 'Good', hasVramInfo: true }), /Recommended/);
  assert.match(explain({ level: 'Borderline', hasVramInfo: true }), /slower|offload/i);
  assert.match(explain({ level: 'Unsupported', hasVramInfo: true }), /Not recommended/i);
  assert.match(explain({ level: 'Excellent', hasVramInfo: false }), /not fully detected/i);
  assert.match(explain({ level: 'Good', hasVramInfo: true, needsBenchmark: true }), /benchmark/i);
  assert.equal(isRecommended('Excellent'), true);
  assert.equal(isRecommended('Borderline'), false);
});

test('bestForRole picks recommended + higher score; null when no model has the role (no fakes)', () => {
  const mk = (id: string, roles: any, recommended: boolean, score: number, tps?: number): CookbookEntry => ({
    modelId: id, friendlyName: id, actualName: id, roles, level: recommended ? 'Good' : 'Borderline',
    fitLabel: 'Fits in VRAM', recommended, needsBenchmark: tps == null, benchmarkTps: tps ?? null, score, why: '',
  });
  const entries = [mk('a', ['coding'], false, 90), mk('b', ['coding'], true, 50), mk('c', ['fast'], true, 99)];
  assert.equal(bestForRole(entries, 'coding')!.modelId, 'b', 'recommended beats higher score');
  assert.equal(bestForRole(entries, 'reasoning'), null, 'no candidate => null, never invented');
  assert.equal(mc.bestForRoles(entries).fast!.modelId, 'c');
});

test('System Health: Model Cookbook COMPLETE with models, BLOCKED without', () => {
  assert.equal(fm.evaluateArea('cookbook', { modelCount: 2 }).status, 'COMPLETE');
  assert.equal(fm.evaluateArea('cookbook', { modelCount: 0 }).status, 'BLOCKED_BY_SETUP');
});
