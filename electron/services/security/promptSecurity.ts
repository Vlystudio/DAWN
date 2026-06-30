/**
 * promptSecurity.ts — the electron-facing PromptSecurity service. Wraps the pure core
 * (promptSecurityCore) and adds local audit persistence: when untrusted content is
 * inspected and looks suspicious, an audit event is recorded (hashed + redacted preview),
 * surfaced in Settings → Security, and (subtly) flagged on the brain graph. It never
 * blocks content on its own — it scores, wraps, logs, and lets risky-tool flows gate.
 */
import db from '../db';
import logger from '../logger';
import core, { SourceType, InjectionScan, PromptSecurityEvent } from './promptSecurityCore';

const MAX_EVENTS = 1000;

function persist(ev: PromptSecurityEvent) {
  db.run(
    'INSERT INTO prompt_security_events (id,ts,source_type,source_id,label,risk_score,severity,matched_patterns,action_taken,excerpt_hash,excerpt_preview,related_node_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [ev.id, ev.ts, ev.sourceType, ev.sourceId, ev.label, ev.riskScore, ev.severity, JSON.stringify(ev.matchedPatterns), ev.actionTaken, ev.excerptHash, ev.excerptPreview, ev.relatedBrainNodeId]
  );
  // bound the table
  const ids = db.all('SELECT id FROM prompt_security_events ORDER BY ts DESC').map((r: any) => r.id);
  for (const old of ids.slice(MAX_EVENTS)) db.run('DELETE FROM prompt_security_events WHERE id=?', [old]);
}

/** Shape + persist an audit event (re-exported name from the spec). */
export function createPromptSecurityAuditEvent(input: Parameters<typeof core.createPromptSecurityAuditEvent>[0]): PromptSecurityEvent {
  const ev = core.createPromptSecurityAuditEvent(input);
  try { persist(ev); } catch (e: any) { logger.warn('security', `audit persist failed: ${e.message}`); }
  if (ev.severity === 'high') logger.warn('security', `Possible prompt injection in ${ev.sourceType}${ev.sourceId ? ' ' + ev.sourceId.slice(0, 8) : ''}: ${ev.matchedPatterns.join(', ')}`);
  return ev;
}

/**
 * Inspect untrusted content before it reaches a prompt. Scans for injection patterns and,
 * when suspicious, records an audit event. Returns the scan so callers can warn the user.
 * Does NOT block — wrapping (done by the prompt builders) already neutralizes the content.
 */
export function inspect(label: string, content: string, sourceType: SourceType, sourceId?: string, relatedBrainNodeId?: string): { scan: InjectionScan; eventId?: string } {
  const scan = core.scanForInjectionPatterns(content);
  if (scan.severity === 'none') return { scan };
  const ev = createPromptSecurityAuditEvent({ sourceType, sourceId, label, content, scan, relatedBrainNodeId });
  return { scan, eventId: ev.id };
}

export function recent(limit = 100) {
  return db.all('SELECT * FROM prompt_security_events ORDER BY ts DESC LIMIT ?', [Math.min(500, limit)])
    .map((r: any) => ({ ...r, matched_patterns: safeParse(r.matched_patterns) }));
}
export function count(): number {
  return (db.get('SELECT COUNT(*) AS n FROM prompt_security_events') as any)?.n || 0;
}
export function clear(): boolean { db.run('DELETE FROM prompt_security_events'); return true; }

/** Source ids with a recent medium/high event — used to subtly flag brain nodes. */
export function flaggedSourceIds(): Set<string> {
  return new Set(db.all("SELECT DISTINCT source_id FROM prompt_security_events WHERE severity IN ('medium','high') AND source_id IS NOT NULL").map((r: any) => r.source_id));
}

function safeParse(s: string) { try { return JSON.parse(s || '[]'); } catch { return []; } }

// Re-export the pure helpers so callers can use one import.
export const {
  wrapUntrustedContent, wrapUntrusted, wrapNumbered, sanitizeToolOutput,
  buildSafeModelMessages, assertNoUntrustedSystemRole, buildUntrustedContextPolicy,
  scanForInjectionPatterns, SOURCE_TYPES, UNTRUSTED_SYSTEM_RULE,
} = core;

export default {
  inspect, createPromptSecurityAuditEvent, recent, count, clear, flaggedSourceIds,
  wrapUntrustedContent, wrapUntrusted, wrapNumbered, sanitizeToolOutput,
  buildSafeModelMessages, assertNoUntrustedSystemRole, buildUntrustedContextPolicy, scanForInjectionPatterns,
};
