/**
 * Tests for per-file stale detection (knowledgeStaleCore). It must never fabricate a stale state:
 * unchanged stays indexed, a newer mtime or different size goes stale, a missing file is removed, and
 * with no comparison metadata it honestly returns "unknown". No filesystem. Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import ks, { classifyStale } from '../electron/services/knowledge/knowledgeStaleCore';

test('unchanged file stays indexed', () => {
  assert.equal(classifyStale({ existsNow: true, currentMtime: 1000, currentSize: 50, indexedMtime: 1000, indexedSize: 50 }), 'indexed');
});

test('newer mtime → stale; different size → stale', () => {
  assert.equal(classifyStale({ existsNow: true, currentMtime: 9000, currentSize: 50, indexedMtime: 1000, indexedSize: 50 }), 'stale');
  assert.equal(classifyStale({ existsNow: true, currentMtime: 1000, currentSize: 77, indexedMtime: 1000, indexedSize: 50 }), 'stale');
});

test('sub-second mtime jitter is NOT treated as stale', () => {
  assert.equal(classifyStale({ existsNow: true, currentMtime: 1000.5, currentSize: 50, indexedMtime: 1000, indexedSize: 50 }), 'indexed');
});

test('missing file → removed (never faked)', () => {
  assert.equal(classifyStale({ existsNow: false, indexedMtime: 1000, indexedSize: 50 }), 'removed');
});

test('no stored metadata → unknown (honest, not stale)', () => {
  assert.equal(classifyStale({ existsNow: true, currentMtime: 9999, currentSize: 1 }), 'unknown');
  // size-only comparison still works
  assert.equal(classifyStale({ existsNow: true, currentSize: 60, indexedSize: 50 }), 'stale');
});
