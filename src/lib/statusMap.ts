/**
 * statusMap.ts — DAWN's single source of truth for status language. One tested place that maps every
 * status code (feature maturity, knowledge lifecycle, retrieval mode, model fit, tool risk, setup) to
 * a display label, a badge tone (uiCore BadgeKind), a plain-English explanation, and an optional
 * next-action hint. Pure/framework-free so screens and tests share it. Unknown codes resolve safely to
 * an "Unknown" neutral badge — never a crash, never fake reassurance.
 */

export type Tone = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'disabled' | 'locked' | 'encrypted' | 'ok' | 'warning' | 'error';
export interface StatusDef { key: string; label: string; tone: Tone; explain: string; next?: string }
export type StatusGroup = 'feature' | 'knowledge' | 'retrieval' | 'modelFit' | 'toolRisk' | 'setup';

const UNKNOWN: StatusDef = { key: 'unknown', label: 'Unknown', tone: 'disabled', explain: 'Status not recognised.' };

const FEATURE: Record<string, StatusDef> = {
  COMPLETE: { key: 'COMPLETE', label: 'Complete', tone: 'ok', explain: 'Wired end-to-end and usable.' },
  PARTIAL: { key: 'PARTIAL', label: 'Partial', tone: 'warning', explain: 'Works, but pieces are missing or unexercised.' },
  BLOCKED_BY_SETUP: { key: 'BLOCKED_BY_SETUP', label: 'Needs setup', tone: 'locked', explain: 'Implemented, but needs setup/credentials from you.', next: 'Open its setup.' },
  BROKEN: { key: 'BROKEN', label: 'Broken', tone: 'error', explain: 'Present but failing a health check.', next: 'Check Logs / re-run.' },
  STUB: { key: 'STUB', label: 'Stub', tone: 'disabled', explain: 'Scaffolding only.' },
  MISSING: { key: 'MISSING', label: 'Missing', tone: 'disabled', explain: 'Not implemented yet.' },
  DISABLED: { key: 'DISABLED', label: 'Disabled', tone: 'disabled', explain: 'Turned off in settings.' },
};

const KNOWLEDGE: Record<string, StatusDef> = {
  pending: { key: 'pending', label: 'Pending', tone: 'disabled', explain: 'Added but not processed yet.' },
  validating: { key: 'validating', label: 'Validating', tone: 'warning', explain: 'Safety/type/size checks running.' },
  indexing: { key: 'indexing', label: 'Indexing', tone: 'warning', explain: 'Indexing in progress.' },
  indexed: { key: 'indexed', label: 'Indexed', tone: 'ok', explain: 'Indexed and searchable.' },
  skipped: { key: 'skipped', label: 'Skipped', tone: 'disabled', explain: 'Not indexed (safety or unsupported type/size).' },
  stale: { key: 'stale', label: 'Stale', tone: 'warning', explain: 'File changed since indexing.', next: 'Re-index to refresh.' },
  failed: { key: 'failed', label: 'Failed', tone: 'error', explain: 'Indexing failed (see the sanitized error).' },
  removed: { key: 'removed', label: 'Removed', tone: 'disabled', explain: 'Source file is gone.' },
  unknown: { key: 'unknown', label: 'Unknown', tone: 'disabled', explain: 'No metadata to determine state.' },
};

const RETRIEVAL: Record<string, StatusDef> = {
  embeddings: { key: 'embeddings', label: 'Embeddings active', tone: 'ok', explain: 'Chunks have vector embeddings.' },
  'keyword fallback': { key: 'keyword fallback', label: 'Keyword fallback', tone: 'warning', explain: 'Local keyword/hash retrieval — no neural embedding model.' },
  'embeddings missing': { key: 'embeddings missing', label: 'Embeddings missing', tone: 'warning', explain: 'No embedding model configured.' },
  none: { key: 'none', label: 'Not indexed', tone: 'disabled', explain: 'Nothing indexed yet.' },
};

const MODEL_FIT: Record<string, StatusDef> = {
  'Fits in VRAM': { key: 'Fits in VRAM', label: 'Fits in VRAM', tone: 'ok', explain: 'Runs fully on the GPU.' },
  'Partial offload': { key: 'Partial offload', label: 'Partial offload', tone: 'warning', explain: 'Some layers on CPU — slower.' },
  'CPU fallback': { key: 'CPU fallback', label: 'CPU fallback', tone: 'warning', explain: 'Runs on CPU — expect slow generation.' },
  'Too large / not recommended': { key: 'Too large / not recommended', label: 'Too large', tone: 'error', explain: "Doesn't fit this hardware." },
  'Needs benchmark': { key: 'Needs benchmark', label: 'Needs benchmark', tone: 'warning', explain: 'Run a benchmark to confirm speed.', next: 'Benchmark it.' },
  'Unknown hardware': { key: 'Unknown hardware', label: 'Unknown hardware', tone: 'disabled', explain: 'GPU/VRAM not detected.' },
  'Unknown model': { key: 'Unknown model', label: 'Unknown model', tone: 'disabled', explain: 'No metadata for this model.' },
};

const TOOL_RISK: Record<string, StatusDef> = {
  safe: { key: 'safe', label: 'Safe read', tone: 'safe', explain: 'Read-only, no side effects.' },
  low: { key: 'low', label: 'Low', tone: 'low', explain: 'Low risk.' },
  medium: { key: 'medium', label: 'Medium', tone: 'medium', explain: 'Moderate risk — may need approval.' },
  high: { key: 'high', label: 'High', tone: 'high', explain: 'High risk — approval required.' },
  critical: { key: 'critical', label: 'Critical', tone: 'critical', explain: 'Critical — explicit approval, never auto-run.' },
  shell: { key: 'shell', label: 'Shell', tone: 'critical', explain: 'Runs shell commands — approval required.' },
  credential: { key: 'credential', label: 'Credential', tone: 'high', explain: 'Touches secrets — approval required.' },
  destructive: { key: 'destructive', label: 'Destructive', tone: 'critical', explain: 'Can delete/overwrite — approval required.' },
};

const SETUP: Record<string, StatusDef> = {
  READY: { key: 'READY', label: 'Ready', tone: 'ok', explain: 'Configured and working.' },
  OPTIONAL: { key: 'OPTIONAL', label: 'Optional', tone: 'disabled', explain: 'Not required.' },
  SKIPPED: { key: 'SKIPPED', label: 'Skipped', tone: 'disabled', explain: 'You chose to skip this.' },
  NEEDS_ACTION: { key: 'NEEDS_ACTION', label: 'Needs action', tone: 'warning', explain: 'Something to finish.', next: 'Open its setup.' },
  FAILED: { key: 'FAILED', label: 'Failed', tone: 'error', explain: 'Setup attempt failed.' },
  NOT_CONFIGURED: { key: 'NOT_CONFIGURED', label: 'Not configured', tone: 'locked', explain: 'Not set up yet.' },
};

const GROUPS: Record<StatusGroup, Record<string, StatusDef>> = {
  feature: FEATURE, knowledge: KNOWLEDGE, retrieval: RETRIEVAL, modelFit: MODEL_FIT, toolRisk: TOOL_RISK, setup: SETUP,
};

/** Resolve a status in a group → StatusDef (safe Unknown fallback, never throws). */
export function resolveStatus(group: StatusGroup, key: any): StatusDef {
  const g = GROUPS[group];
  if (!g) return UNKNOWN;
  const def = g[String(key)];
  return def || { ...UNKNOWN, key: String(key ?? 'unknown') };
}
export function statusLabel(group: StatusGroup, key: any): string { return resolveStatus(group, key).label; }
export function statusTone(group: StatusGroup, key: any): Tone { return resolveStatus(group, key).tone; }
export function statusExplain(group: StatusGroup, key: any): string { return resolveStatus(group, key).explain; }

export const STATUS_GROUPS = GROUPS;
export default { resolveStatus, statusLabel, statusTone, statusExplain, STATUS_GROUPS };
