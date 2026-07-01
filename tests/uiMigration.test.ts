/**
 * Tests for the UI migration registry (uiMigrationCore) + its honest reflection in System Health.
 * The registry is the single source of truth for which screens are migrated and — critically — which
 * split screens still need a HUMAN visual check. These tests guard the beta.15 rule: no further split
 * migration while any split screen is pending, and no fake "confirmed" claims. No electron; no render.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import uiMig, { MIGRATED_SCREENS } from '../electron/services/uiMigrationCore';
import fm from '../electron/services/featureMaturityCore';

test('registry is internally consistent (no dup screens, valid variant/verification)', () => {
  const names = MIGRATED_SCREENS.map((s) => s.screen);
  assert.equal(new Set(names).size, names.length, 'no duplicate screen entries');
  const variants = new Set(['PageShell', 'PageShellPanel', 'PageShellSplit', 'PageShellLog', 'PageShellCanvas']);
  const verifs = new Set(['n/a', 'pending', 'confirmed']);
  for (const s of MIGRATED_SCREENS) {
    assert.ok(variants.has(s.variant), `${s.screen} has a real variant`);
    assert.ok(verifs.has(s.verification), `${s.screen} has a real verification state`);
    // Only split screens carry a real (pending/confirmed) verification; panels/logs are n/a.
    if (s.variant !== 'PageShellSplit') assert.equal(s.verification, 'n/a', `${s.screen} is a panel/log → n/a`);
  }
});

test('Notes and Documents are registered as split screens with verification still PENDING', () => {
  const split = uiMig.splitScreens().map((s) => s.screen);
  assert.ok(split.includes('Notes') && split.includes('Documents'), 'both split proofs are tracked');
  const pending = uiMig.pendingSplitVerification();
  assert.ok(pending.includes('Notes'), 'Notes verification is pending (no human confirmation claimed)');
  assert.ok(pending.includes('Documents'), 'Documents verification is pending (no human confirmation claimed)');
});

test('the split-migration gate is CLOSED while any split screen is pending', () => {
  assert.equal(uiMig.canMigrateAnotherSplit(), false, 'must not migrate another split screen while pending');
});

test('Tasks and Backup were migrated as simple panels (this batch)', () => {
  const panels = uiMig.panelScreens().map((s) => s.screen);
  assert.ok(panels.includes('Tasks'), 'Tasks → PageShellPanel');
  assert.ok(panels.includes('Backup'), 'Backup → PageShellPanel');
});

test('System Health Design System stays PARTIAL and surfaces the pending split verification', () => {
  const r = fm.evaluateArea('design_system');
  assert.equal(r.status, 'PARTIAL', 'never COMPLETE while screens remain bespoke/unverified');
  assert.ok(r.missing.some((m) => /PENDING/i.test(m) && /Notes/.test(m) && /Documents/.test(m)),
    'the pending split verification is stated honestly in System Health');
  assert.ok(r.works.some((w) => /Tasks/.test(w) && /Backup/.test(w)), 'newly migrated panels are listed');
});
