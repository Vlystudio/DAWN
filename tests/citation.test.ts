/**
 * Tests for the citation metadata builder (citationCore). The whole point is HONESTY: it must never
 * fabricate page/section/chunk/embedding data — those only appear when real values are passed, and are
 * otherwise listed as unavailable. It must also never leak a full path (file name only). No DB.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import cc, { buildCitation, precisionOf, safeDisplayPath } from '../electron/services/knowledge/citationCore';

test('safeDisplayPath returns the file name only — never the full path', () => {
  assert.equal(safeDisplayPath('C:\\Users\\me\\secret\\notes.md'), 'notes.md');
  assert.equal(safeDisplayPath('/home/me/app/data.csv'), 'data.csv');
  assert.equal(safeDisplayPath(''), 'unknown');
});

test('chunk-level citation: chunk index present, page/section honestly unavailable', () => {
  const c = buildCitation({ name: 'notes.md', path: 'C:\\secret\\notes.md', chunkIndex: 3, sourceType: 'file', retrievalMode: 'keyword fallback' });
  assert.equal(c.precision, 'chunk-level');
  assert.equal(c.chunkIndex, 3);
  assert.equal(c.fileName, 'notes.md');
  assert.ok(!JSON.stringify(c).includes('C:\\secret'), 'no full path leaks into the citation');
  assert.ok(c.available.includes('chunk index'));
  assert.ok(c.unavailable.includes('page number') && c.unavailable.includes('section heading'), 'page/section reported as unavailable, not faked');
  assert.equal(c.page, undefined);
  assert.equal(c.section, undefined);
});

test('file-level when no chunk; page-level only when a real page is provided', () => {
  assert.equal(buildCitation({ name: 'a.txt' }).precision, 'file-level');
  const withPage = buildCitation({ name: 'doc.pdf', chunkIndex: 1, page: 5 });
  assert.equal(withPage.precision, 'page-level');
  assert.equal(withPage.page, 5);
  assert.ok(withPage.available.includes('page number'));
});

test('embedding model only appears when real; precision ladder is honest', () => {
  assert.equal(buildCitation({ name: 'a' }).embeddingModel, undefined);
  assert.ok(buildCitation({ name: 'a' }).unavailable.includes('embedding model'));
  assert.equal(buildCitation({ name: 'a', embeddingModel: 'nomic-embed-text' }).embeddingModel, 'nomic-embed-text');
  assert.equal(precisionOf({ name: 'a', chunkIndex: 0, section: 'Intro' }), 'section-level');
  assert.equal(precisionOf({}), 'unknown');
});
