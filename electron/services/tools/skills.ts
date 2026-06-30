/**
 * skills.ts — user-created/editable skills. A skill bundles an instruction body + a set of
 * allowed tools. The body is UNTRUSTED: it is wrapped by PromptSecurity and passed as
 * user-role context (never system/developer), so it can't override DAWN's rules. Tool calls
 * from a skill are restricted to its allowed list and routed through the ToolExecutionGateway.
 */
import * as crypto from 'crypto';
import db from '../db';
import logger from '../logger';
import runtime from '../runtime';
import settings from '../settings';
import * as llama from '../llama';
import security from '../security/promptSecurity';
import registry from './toolRegistry';
import gateway from './toolGateway';
import core from './toolRegistryCore';

const newId = () => crypto.randomUUID();
const now = () => Date.now();
const rebuild = () => { try { require('../graph').default.rebuild(); } catch { /* */ } };

function hydrate(row: any) {
  if (!row) return row;
  const allowed = safeParse(row.allowed_tools);
  return { ...row, allowed_tools: allowed, risk_level: core.skillRiskLevel(allowed, registry.list()) };
}

export function list() { return db.all('SELECT * FROM skills ORDER BY updated_at DESC LIMIT 500').map(hydrate); }
export function get(id: string) {
  const row: any = db.get('SELECT * FROM skills WHERE id=?', [id]);
  if (!row) return null;
  return { ...hydrate(row), runs: db.all('SELECT * FROM skill_runs WHERE skill_id=? ORDER BY created_at DESC LIMIT 20', [id]) };
}

export function create(opts: { name?: string; description?: string; body?: string; allowedToolIds?: string[]; tags?: string; enabled?: boolean }) {
  const id = newId();
  const allowed = (opts.allowedToolIds || []).filter((t) => registry.get(t));
  const risk = core.skillRiskLevel(allowed, registry.list());
  db.run('INSERT INTO skills (id,name,description,body,enabled,allowed_tools,risk_level,tags,created_at,updated_at,run_count) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
    [id, opts.name || 'New skill', opts.description || '', opts.body || '', opts.enabled === false ? 0 : 1, JSON.stringify(allowed), risk, opts.tags || '', now(), now()]);
  rebuild();
  return get(id);
}
export function update(id: string, patch: any) {
  const row: any = db.get('SELECT * FROM skills WHERE id=?', [id]);
  if (!row) return null;
  const allowed = patch.allowedToolIds !== undefined ? (patch.allowedToolIds || []).filter((t: string) => registry.get(t)) : safeParse(row.allowed_tools);
  const f = (k: string, v?: any) => (patch[k] !== undefined ? patch[k] : (v !== undefined ? v : row[k]));
  db.run('UPDATE skills SET name=?, description=?, body=?, enabled=?, allowed_tools=?, risk_level=?, tags=?, updated_at=? WHERE id=?',
    [f('name'), f('description'), f('body'), patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled, JSON.stringify(allowed), core.skillRiskLevel(allowed, registry.list()), f('tags'), now(), id]);
  rebuild();
  return get(id);
}
export function remove(id: string) {
  db.run('DELETE FROM skills WHERE id=?', [id]);
  db.run('DELETE FROM skill_runs WHERE skill_id=?', [id]);
  rebuild();
  return true;
}

/** Test/run a skill with the local model. Skill body is untrusted → user-role + asserted. */
export async function test(id: string, userInput = ''): Promise<{ ok: boolean; error?: string; output?: string }> {
  const skill: any = db.get('SELECT * FROM skills WHERE id=?', [id]);
  if (!skill) return { ok: false, error: 'Skill not found.' };
  if (!runtime.isReady()) return { ok: false, error: 'Turn DAWN ON and load a model first.' };
  const runId = newId();
  try {
    // PromptSecurity: skill body is untrusted user content.
    security.inspect(`skill: ${skill.name}`, skill.body, 'skill', id, `skill:${id}`);
    const messages = core.buildSkillTestMessages({ name: skill.name, body: skill.body }, userInput, settings.get().defaultSystemPrompt);
    security.assertNoUntrustedSystemRole(messages); // body must never be in the system role
    const output = (await llama.chat(runtime.baseUrl(), messages, { temperature: 0.5, max_tokens: 1024 })).trim();
    db.run('INSERT INTO skill_runs (id,skill_id,status,input_hash,output_hash,created_at) VALUES (?,?,?,?,?,?)',
      [runId, id, 'ok', sha(userInput), sha(output), now()]);
    db.run('UPDATE skills SET last_run_at=?, run_count=run_count+1 WHERE id=?', [now(), id]);
    rebuild();
    return { ok: true, output };
  } catch (e: any) {
    db.run('INSERT INTO skill_runs (id,skill_id,status,error,created_at) VALUES (?,?,?,?,?)', [runId, id, 'error', String(e.message).slice(0, 200), now()]);
    return { ok: false, error: e.message };
  }
}

/**
 * Invoke a tool on behalf of a skill. The tool MUST be in the skill's allowed list, else
 * the call is denied and audited. Allowed calls go through the gateway (approval + sanitize
 * + audit), tagged with the skill id.
 */
export async function invokeTool(id: string, toolId: string, input: any): Promise<{ ok: boolean; error?: string; result?: any }> {
  const skill: any = db.get('SELECT * FROM skills WHERE id=?', [id]);
  if (!skill) return { ok: false, error: 'Skill not found.' };
  if (!skill.enabled) return { ok: false, error: 'Skill is disabled.' };
  const allowed = safeParse(skill.allowed_tools);
  if (!core.skillAllowsTool({ allowedToolIds: allowed }, toolId)) {
    // Denied: not in the skill's allow-list → audit it.
    registry.recordAudit(core.shapeToolAuditEvent({
      toolId, toolName: toolId, providerId: 'dawn', skillId: id, riskLevel: 'high', permission: 'none',
      approvalRequired: true, approvalDecision: 'deny', status: 'denied', errorMessage: 'tool not in skill allow-list', input,
    }));
    logger.warn('skills', `Skill ${id.slice(0, 8)} tried to call unallowed tool ${toolId}`);
    return { ok: false, error: `This skill is not allowed to use "${toolId}".` };
  }
  const r = await gateway.execute(toolId, input, { skillId: id });
  return { ok: r.ok, error: r.error, result: r.output };
}

export function auditRecent(id?: string, limit = 50) {
  return id
    ? db.all('SELECT * FROM skill_runs WHERE skill_id=? ORDER BY created_at DESC LIMIT ?', [id, Math.min(200, limit)])
    : db.all('SELECT * FROM skill_runs ORDER BY created_at DESC LIMIT ?', [Math.min(200, limit)]);
}

function sha(s: string) { return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex'); }
function safeParse(s: string): string[] { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

export default { list, get, create, update, remove, test, invokeTool, auditRecent };
