/**
 * toolRegistry.ts — the central Tool Registry service. Merges the built-in tool catalog
 * with the user's enable/disable + always-allow overrides and with reality (e.g. shell is
 * only "enabled" when PowerShell is allowed in Settings). Also owns the persistent tool
 * audit log. Future tools are always reported disabled and never run.
 */
import * as crypto from 'crypto';
import db from '../db';
import settings from '../settings';
import core, { BUILTIN_TOOLS, ToolDef, ApprovalMode } from './toolRegistryCore';
import { providers, getProvider } from './providers';

const now = () => Date.now();

export interface EffectiveTool extends ToolDef { alwaysAllow: boolean }

/** Default enabled state for a tool given current settings (before user overrides). */
function defaultEnabled(def: ToolDef): boolean {
  if (def.future) return false;
  const s = settings.get();
  switch (def.id) {
    case 'shell.powershell': return !!s.powershellEnabled;
    case 'network.fetch': return !!s.webEnabled;
    case 'file.read': case 'file.write': return !!s.fileAgentEnabled;
    case 'research.fetch': return !!s.researchAllowWeb;
    default: return def.enabled;
  }
}

function overrides(): Map<string, any> {
  const m = new Map<string, any>();
  try { for (const r of db.all('SELECT * FROM tool_state')) m.set(r.tool_id, r); } catch { /* */ }
  return m;
}

export function list(): EffectiveTool[] {
  const ov = overrides();
  return BUILTIN_TOOLS.map((def) => {
    const o = ov.get(def.id);
    const enabled = def.future ? false : (o && o.enabled != null ? !!o.enabled : defaultEnabled(def));
    return { ...def, enabled, alwaysAllow: o ? !!o.always_allow : false };
  });
}
export function get(id: string): EffectiveTool | null { return list().find((t) => t.id === id) || null; }

export function updateEnabled(id: string, enabled: boolean): EffectiveTool | null {
  const def = BUILTIN_TOOLS.find((t) => t.id === id);
  if (!def) return null;
  if (def.future) return get(id); // future tools can't be enabled
  upsert(id, { enabled: enabled ? 1 : 0 });
  rebuildGraph();
  return get(id);
}
export function setAlwaysAllow(id: string, val: boolean) {
  const t = get(id);
  if (!t || !core.canAlwaysAllow(t)) return false; // never for shell/vault/email/settings/etc.
  upsert(id, { always_allow: val ? 1 : 0 });
  return true;
}
function upsert(id: string, patch: any) {
  const cur: any = db.get('SELECT * FROM tool_state WHERE tool_id=?', [id]) || {};
  db.run('INSERT OR REPLACE INTO tool_state (tool_id,enabled,always_allow,updated_at) VALUES (?,?,?,?)',
    [id, patch.enabled != null ? patch.enabled : (cur.enabled != null ? cur.enabled : null), patch.always_allow != null ? patch.always_allow : (cur.always_allow || 0), now()]);
}

export function approvalMode(): ApprovalMode {
  const m = settings.get().toolApprovalMode;
  return (m === 'strict' || m === 'permissive_low' || m === 'balanced') ? m : 'balanced';
}

export function providerList() {
  return providers().map((p) => ({ id: p.id, name: p.name, type: p.type, enabled: p.enabled, tools: p.listTools().length, status: p.status() }));
}

// --- audit -----------------------------------------------------------------
const MAX_AUDIT = 2000;
export function recordAudit(ev: ReturnType<typeof core.shapeToolAuditEvent>) {
  db.run(
    'INSERT INTO tool_audit (id,ts,tool_id,tool_name,provider_id,skill_id,risk_level,permission,approval_required,approval_decision,input_hash,input_preview,output_hash,output_preview,status,error_message,duration_ms,related_node_id,prompt_security_event_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [ev.id, ev.ts, ev.toolId, ev.toolName, ev.providerId, ev.skillId, ev.riskLevel, ev.permission, ev.approvalRequired, ev.approvalDecision, ev.inputHash, ev.inputPreview, ev.outputHash, ev.outputPreview, ev.status, ev.errorMessage, ev.durationMs, ev.relatedBrainNodeId, ev.promptSecurityEventIds]
  );
  const ids = db.all('SELECT id FROM tool_audit ORDER BY ts DESC').map((r: any) => r.id);
  for (const old of ids.slice(MAX_AUDIT)) db.run('DELETE FROM tool_audit WHERE id=?', [old]);
}
export function auditRecent(limit = 100) {
  return db.all('SELECT * FROM tool_audit ORDER BY ts DESC LIMIT ?', [Math.min(500, limit)])
    .map((r: any) => ({ ...r, prompt_security_event_ids: safeParse(r.prompt_security_event_ids) }));
}
export function auditClear() { db.run('DELETE FROM tool_audit'); return true; }

function safeParse(s: string) { try { return JSON.parse(s || '[]'); } catch { return []; } }
function rebuildGraph() { try { require('../graph').default.rebuild(); } catch { /* */ } }

export { getProvider };
export default { list, get, updateEnabled, setAlwaysAllow, approvalMode, providerList, recordAudit, auditRecent, auditClear, getProvider };
