/**
 * diagnosticsCore.ts — pure, electron-free heart of DAWN's redacted diagnostics export. It strips
 * secrets from settings (by key name AND value pattern), redacts log lines, shapes the bundle, and
 * builds a short copy-paste error summary. The electron service only gathers raw inputs and writes
 * the file; all the redaction (the security-critical part) lives here and is unit-tested.
 */

/** Settings keys whose VALUE is a secret and must be blanked entirely. */
export const SECRET_KEY_RE = /(token|secret|password|passwd|pin\b|api[_-]?key|apikey|seed|credential)/i;

const VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{12,}/g, /ntn_[A-Za-z0-9]{12,}/g, /ghp_[A-Za-z0-9]{12,}/g, /github_pat_[A-Za-z0-9_]{12,}/g,
  /AKIA[0-9A-Z]{16}/g, /xox[baprs]-[A-Za-z0-9-]{10,}/g, /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /-----BEGIN[^-]+PRIVATE KEY-----/g, /\b[A-Z2-7]{20,}\b/g,
];

/** Mask obvious secret substrings inside an arbitrary string value. */
export function redactValue(v: any): any {
  if (typeof v !== 'string') return v;
  let out = v;
  for (const re of VALUE_PATTERNS) out = out.replace(re, '⟨redacted⟩');
  return out;
}

/** Return a copy of a settings object with secret-keyed values blanked + value patterns masked. */
export function redactSettings(settings: Record<string, any> | null | undefined): Record<string, any> {
  const src = settings && typeof settings === 'object' ? settings : {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = v ? '⟨redacted⟩' : ''; continue; }
    if (Array.isArray(v)) { out[k] = v.map(redactValue); continue; }
    out[k] = redactValue(v);
  }
  return out;
}

/** Redact a single log line (message text). */
export function redactLogLine(line: string): string {
  return String(redactValue(line ?? ''));
}

export interface BundleInput {
  app?: { name?: string; version?: string };
  system?: Record<string, any>;
  runtime?: Record<string, any> | null;
  health?: { completionPct?: number; byStatus?: Record<string, number>; total?: number } | null;
  settings?: Record<string, any> | null;
  logs?: { ts?: number; level?: string; source?: string; message?: string }[] | null;
  db?: Record<string, any> | null;
  errors?: string[];
}

/** Build the final, fully-redacted diagnostics bundle object. */
export function buildBundle(input: BundleInput): Record<string, any> {
  return {
    generatedAt: new Date().toISOString(),
    note: 'DAWN diagnostics — secrets are redacted (settings keys + value patterns + log lines).',
    app: input.app || {},
    system: input.system || {},
    runtime: input.runtime || null,
    health: input.health || null,
    db: input.db || null,
    settings: redactSettings(input.settings),
    recentErrors: (input.errors || []).map(redactLogLine).slice(0, 50),
    logs: (input.logs || []).slice(0, 300).map((l) => ({ ts: l.ts, level: l.level, source: l.source, message: redactLogLine(l.message || '') })),
  };
}

/** A short, copy-pasteable error summary for support/triage. */
export function copySummary(bundle: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`DAWN ${bundle?.app?.version || '?'} on ${bundle?.system?.platform || '?'}`);
  if (bundle?.runtime) lines.push(`Runtime: ${bundle.runtime.state || 'unknown'}${bundle.runtime.backend ? ' / ' + bundle.runtime.backend : ''}`);
  if (bundle?.health) lines.push(`Completion: ${bundle.health.completionPct ?? '?'}% (${bundle.health.byStatus?.BROKEN || 0} broken, ${bundle.health.byStatus?.MISSING || 0} missing)`);
  const errs: string[] = bundle?.recentErrors || [];
  if (errs.length) { lines.push(`Recent errors (${errs.length}):`); for (const e of errs.slice(0, 8)) lines.push(`  • ${e}`); }
  else lines.push('No recent errors logged.');
  return lines.join('\n');
}

export default { SECRET_KEY_RE, redactValue, redactSettings, redactLogLine, buildBundle, copySummary };
