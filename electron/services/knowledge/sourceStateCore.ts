/**
 * sourceStateCore.ts — pure, electron-free lifecycle state machine for Local Knowledge sources. It
 * defines the legal states + transitions, the helpers the indexer uses to advance state honestly, and
 * a sanitizer so a failure message never leaks a secret or an absolute path. No DB — the rag service
 * persists `state`; this module owns the rules and is unit-tested.
 */

export const SOURCE_STATES = ['pending', 'validating', 'skipped', 'indexing', 'indexed', 'stale', 'failed', 'removed'] as const;
export type SourceState = typeof SOURCE_STATES[number];

/** Legal transitions. (Re-adding a removed source starts a fresh pending.) */
const TRANSITIONS: Record<SourceState, SourceState[]> = {
  pending: ['validating', 'skipped', 'removed'],
  validating: ['skipped', 'indexing', 'failed', 'removed'],
  skipped: ['validating', 'removed'],
  indexing: ['indexed', 'failed', 'removed'],
  indexed: ['stale', 'indexing', 'removed'],
  stale: ['indexing', 'removed'],
  failed: ['validating', 'indexing', 'removed'],
  removed: ['pending'],
};

export function isSourceState(s: any): s is SourceState { return typeof s === 'string' && (SOURCE_STATES as readonly string[]).includes(s); }

export function canTransition(from: any, to: any): boolean {
  if (!isSourceState(from) || !isSourceState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/** A removed/skipped source must not surface as an active search/workspace result. */
export function isActive(state: any): boolean { return isSourceState(state) && state !== 'removed' && state !== 'skipped'; }
/** Treat a legacy NULL state (rows indexed before this migration) as indexed. */
export function effectiveState(state: any): SourceState { return isSourceState(state) ? state : 'indexed'; }

/**
 * Sanitize a failure message: drop absolute paths, mask secret-looking tokens, collapse + truncate.
 * The result is safe to persist + show (no file contents, no full paths, no secrets).
 */
export function sanitizeError(msg: any, max = 200): string {
  let s = String(msg == null ? '' : (msg.message || msg));
  s = s.replace(new RegExp('[\\u0000-\\u001f\\u007f]+', 'g'), ' ');
  s = s.replace(/[a-zA-Z]:\\[^\s'"]+/g, '<path>').replace(/\/(?:[\w.-]+\/){1,}[\w.-]+/g, '<path>'); // win + unix paths
  s = s.replace(/sk-[A-Za-z0-9]{12,}|ntn_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{12,}|Bearer\s+\S+/gi, '<redacted>');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return 'Indexing failed.';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Roll up a list of source states into honest counts for System Health / the UI. */
export function summarizeStates(states: any[]): Record<SourceState, number> {
  const out: Record<SourceState, number> = { pending: 0, validating: 0, skipped: 0, indexing: 0, indexed: 0, stale: 0, failed: 0, removed: 0 };
  for (const s of states) out[effectiveState(s)]++;
  return out;
}

export default { SOURCE_STATES, isSourceState, canTransition, isActive, effectiveState, sanitizeError, summarizeStates };
