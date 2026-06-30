/**
 * knowledgeStaleCore.ts — pure, electron-free staleness classifier for indexed Local Knowledge
 * sources. It compares the file's CURRENT mtime/size against what was stored at index time and decides
 * whether a source is still `indexed`, has gone `stale` (changed), was `removed` (file gone), or is
 * `unknown` (no comparison metadata). It reads nothing from disk — the rag service stats the file
 * (after the safety guard) and passes the numbers in. Never fabricates a stale state.
 */

export type StaleVerdict = 'indexed' | 'stale' | 'removed' | 'unknown';

export interface StaleInput {
  existsNow: boolean;
  currentMtime?: number | null;
  currentSize?: number | null;
  indexedMtime?: number | null;
  indexedSize?: number | null;
}

const MTIME_TOLERANCE_MS = 1000; // ignore sub-second filesystem jitter

const has = (v: any) => v !== undefined && v !== null && !(typeof v === 'number' && isNaN(v));

/**
 * Decide staleness from REAL metadata only:
 *  - file gone         → 'removed'
 *  - no stored mtime/size to compare → 'unknown' (honest — we can't tell)
 *  - mtime advanced or size differs  → 'stale'
 *  - otherwise         → 'indexed'
 */
export function classifyStale(input: StaleInput): StaleVerdict {
  if (!input.existsNow) return 'removed';
  const haveMeta = has(input.indexedMtime) || has(input.indexedSize);
  if (!haveMeta) return 'unknown';
  if (has(input.indexedMtime) && has(input.currentMtime) && (input.currentMtime as number) > (input.indexedMtime as number) + MTIME_TOLERANCE_MS) return 'stale';
  if (has(input.indexedSize) && has(input.currentSize) && (input.currentSize as number) !== (input.indexedSize as number)) return 'stale';
  return 'indexed';
}

export default { classifyStale };
