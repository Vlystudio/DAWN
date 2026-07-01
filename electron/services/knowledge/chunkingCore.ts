/**
 * chunkingCore.ts — pure, electron-free "chunking v2": title/heading-aware, paragraph-aware, and
 * code-block-preserving splitting for local knowledge indexing. Produces chunks WITH honest metadata
 * (section path, parent heading, real start/end line numbers, char/token estimates, strategy version).
 *
 * Honesty: it never invents page numbers, headings, or line numbers. Headings/section paths come only
 * from real Markdown headings; line numbers are the real source lines; page/row numbers are omitted for
 * text/markdown (only real when the caller can supply them). Chunk text is the real content — the
 * metadata is separate, so citations stay honest.
 */

export const CHUNK_STRATEGY_VERSION = 'v2';

export interface ChunkV2 {
  text: string;
  index: number;
  chunkTitle: string;       // nearest real heading, else a derived first line
  parentHeading: string;    // immediate heading ('' if none)
  sectionPath: string;      // breadcrumb 'H1 > H2 > H3' from real headings
  startLine: number;        // real 1-based source line
  endLine: number;          // real 1-based source line
  strategyVersion: string;
  charCount: number;
  tokenEstimate: number;    // ~chars/4, clearly an estimate
}

interface Block { text: string; startLine: number; endLine: number; isCode: boolean; headingLevel: number }

const HEADING_RE = /^(#{1,6})\s+(.*\S)?/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Parse a document into ordered blocks (headings, atomic code fences, paragraphs) with real line ranges. */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const startLine = i + 1;
    const fence = lines[i].match(FENCE_RE);
    if (fence) {
      const marker = fence[1];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(marker)) j++;
      const endIdx = Math.min(j, lines.length - 1);
      blocks.push({ text: lines.slice(i, endIdx + 1).join('\n'), startLine, endLine: endIdx + 1, isCode: true, headingLevel: 0 });
      i = endIdx + 1;
      continue;
    }
    const h = lines[i].match(HEADING_RE);
    if (h) { blocks.push({ text: lines[i].trim(), startLine, endLine: i + 1, isCode: false, headingLevel: h[1].length }); i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].trim() && !HEADING_RE.test(lines[j]) && !FENCE_RE.test(lines[j])) j++;
    blocks.push({ text: lines.slice(i, j).join('\n'), startLine, endLine: j, isCode: false, headingLevel: 0 });
    i = j;
  }
  return blocks;
}

function firstLine(t: string): string { return (t.split('\n').find((l) => l.trim()) || '').replace(/^#{1,6}\s+/, '').trim(); }

export interface ChunkOpts { size?: number; overlap?: number }

/**
 * Chunk v2. Groups blocks under their heading context up to `size` chars; a code fence is never split
 * (its own chunk if oversized); a heading starts a new section and sets the context. Real block-level
 * overlap: the last paragraph of a flushed chunk seeds the next.
 */
export function chunkV2(text: string, opts: ChunkOpts = {}): ChunkV2[] {
  const size = Math.max(200, opts.size || 1200);
  const overlap = Math.min(size - 50, Math.max(0, opts.overlap ?? 200));
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const blocks = parseBlocks(clean);
  if (!blocks.length) return [];

  const out: ChunkV2[] = [];
  const stack: { level: number; title: string }[] = [];
  let cur: Block[] = [];
  let curChars = 0;
  let snapshot: string[] = [];

  const flush = () => {
    if (!cur.length) return;
    const body = cur.map((b) => b.text).join('\n\n').trim();
    if (!body) { cur = []; curChars = 0; return; }
    const parent = snapshot;
    const title = (parent.length ? parent[parent.length - 1] : firstLine(body)) || 'section';
    out.push({
      text: body, index: out.length,
      chunkTitle: title.slice(0, 120),
      parentHeading: (parent.length ? parent[parent.length - 1] : '').slice(0, 120),
      sectionPath: parent.join(' > ').slice(0, 300),
      startLine: cur[0].startLine, endLine: cur[cur.length - 1].endLine,
      strategyVersion: CHUNK_STRATEGY_VERSION, charCount: body.length, tokenEstimate: Math.round(body.length / 4),
    });
    // block-level overlap: seed next chunk with the last non-code paragraph.
    const last = cur[cur.length - 1];
    cur = (overlap > 0 && !last.isCode && last.text.length <= overlap * 2) ? [last] : [];
    curChars = cur.reduce((n, b) => n + b.text.length, 0);
  };

  for (const b of blocks) {
    if (b.headingLevel > 0) {
      flush();
      cur = []; curChars = 0; // headings reset overlap
      const title = b.text.replace(/^#{1,6}\s+/, '').trim();
      while (stack.length && stack[stack.length - 1].level >= b.headingLevel) stack.pop();
      stack.push({ level: b.headingLevel, title });
      snapshot = stack.map((h) => h.title);
      continue;
    }
    if (!cur.length) snapshot = stack.map((h) => h.title);
    const blen = b.text.length;
    if (b.isCode && blen > size) { flush(); cur = [b]; curChars = blen; flush(); continue; }
    if (curChars + blen > size && cur.length) { flush(); if (!cur.length) snapshot = stack.map((h) => h.title); }
    cur.push(b); curChars += blen;
  }
  flush();
  // re-index (overlap seeding can create an empty leading chunk edge case)
  return out.filter((c) => c.text).map((c, i) => ({ ...c, index: i }));
}

/** True if a source indexed with `existingStrategy` should be reindexed to the current version. */
export function needsReindex(existingStrategy: string | null | undefined): boolean {
  return (existingStrategy || 'v1') !== CHUNK_STRATEGY_VERSION;
}

export default { CHUNK_STRATEGY_VERSION, chunkV2, needsReindex };
