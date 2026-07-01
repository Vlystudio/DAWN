/**
 * Tests for the page-shell layout invariants (src/ui/shellLayout). These are the "guardrails testable
 * without eyesight": they assert the region class strings guarantee the right scroll/flex behaviour so
 * a shell variant can't silently reintroduce the beta.12 bug (whole-page scroll where a fixed
 * header + inner scroll box was intended). No React render. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import sl, { SHELL, isScrollable, canShrink, hasIndependentScroll, isCleanFlexBody } from '../src/ui/shellLayout';

test('simple page + panel scroll at the top level', () => {
  assert.ok(isScrollable(SHELL.page));
  assert.ok(isScrollable(SHELL.panelRoot));
});

test('split shell: header is fixed, body is a clean flex host, columns scroll independently', () => {
  assert.ok(!isScrollable(SHELL.splitHeader), 'split header must be fixed (not scroll)');
  assert.ok(SHELL.splitHeader.includes('shrink-0'), 'split header must not shrink');
  assert.ok(isCleanFlexBody(SHELL.splitBody), 'split body fills + shrinks + does NOT scroll (no double-scroll)');
  assert.ok(hasIndependentScroll(SHELL.splitSidebar, SHELL.splitMain), 'sidebar + main scroll independently');
  assert.ok(canShrink(SHELL.splitMain) && canShrink(SHELL.splitSidebar), 'columns must min-h-0 to scroll');
});

test('log shell: header fixed, body is the single scroll box (preserves LogsView behaviour)', () => {
  assert.ok(!isScrollable(SHELL.logHeader), 'log header/actions must be fixed');
  assert.ok(SHELL.logRoot.includes('flex-col'), 'log root is a column');
  assert.ok(isScrollable(SHELL.logBody) && canShrink(SHELL.logBody), 'exactly the log body scrolls');
});

test('canvas shell: body is full-bleed and NOT scrolling (the canvas owns rendering)', () => {
  assert.ok(!isScrollable(SHELL.canvasBody), 'canvas region must not add its own scroll');
  assert.ok(SHELL.canvasBody.includes('relative'), 'canvas region is a positioning context');
  assert.ok(!isScrollable(SHELL.canvasHeader), 'canvas header fixed');
  assert.ok(isScrollable(SHELL.canvasDetail), 'the optional detail side panel scrolls on its own');
});

test('helpers behave', () => {
  assert.equal(isScrollable('a overflow-y-auto b'), true);
  assert.equal(isScrollable('a b'), false);
  assert.equal(isCleanFlexBody('flex-1 min-h-0 flex'), true);
  assert.equal(isCleanFlexBody('flex-1 min-h-0 overflow-y-auto'), false, 'a scrolling flex body is not "clean" (double-scroll risk)');
});
