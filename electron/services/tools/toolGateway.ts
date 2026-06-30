/**
 * toolGateway.ts — the Tool Execution Gateway. Every registered tool call should flow
 * through here: validate the tool exists / is enabled / not future, validate input against
 * its schema, scan the input/context for prompt-injection risk, require approval per the
 * risk level + mode, execute via the tool's provider, sanitize the output through
 * PromptSecurity, write an audit event, and return a typed result (errors redacted).
 *
 * Dependencies are injected so the gateway is unit-testable without electron/db. The
 * default singleton wires the real registry, providers, PromptSecurity, and an event-based
 * approval flow (a request is emitted; the renderer responds; we resolve or time out → deny).
 */
import { EventEmitter } from 'events';
import core, { ToolDef, ApprovalMode } from './toolRegistryCore';

export type EffectiveToolLike = ToolDef & { enabled: boolean; alwaysAllow?: boolean };
export type ApprovalDecision = 'allow_once' | 'always' | 'deny';

export interface ApprovalRequest {
  id: string;
  toolId: string; toolName: string; description: string; riskLevel: string; permission: string;
  reason: string; inputPreview: string; promptSeverity: string; canAlwaysAllow: boolean; skillId?: string | null;
}

export interface GatewayDeps {
  getTool: (id: string) => (EffectiveToolLike | null);
  execProvider: (providerId: string, toolId: string, input: any) => Promise<any>;
  security: {
    sanitizeToolOutput: (s: string, name?: string) => string;
    scanForInjectionPatterns: (s: string) => { severity: 'none' | 'low' | 'medium' | 'high'; matched: string[]; riskScore: number };
    redactPreview: (s: string, max?: number) => string;
    inspect?: (label: string, content: string, sourceType: string, sourceId?: string) => { eventId?: string };
  };
  recordAudit: (event: any) => void;
  approvalMode: () => ApprovalMode;
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  setAlwaysAllow?: (toolId: string, val: boolean) => void;
}

export interface ExecContext {
  skillId?: string | null;
  approver?: (req: ApprovalRequest) => Promise<ApprovalDecision>; // override (tests / programmatic)
  mode?: ApprovalMode;
  untrustedText?: string;          // extra context to factor into the injection scan
  promptRiskSeverity?: 'none' | 'low' | 'medium' | 'high';
  relatedBrainNodeId?: string | null;
}

export interface ExecResult {
  ok: boolean; output?: any; sanitized?: string; error?: string; decision?: string; auditId?: string; blocked?: boolean;
}

const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export class ToolGateway extends EventEmitter {
  private pending = new Map<string, (d: ApprovalDecision) => void>();

  constructor(private deps: GatewayDeps) { super(); }

  /** Default event-based approval: emit a request, await the renderer's response (deny on timeout). */
  defaultRequestApproval = (req: ApprovalRequest, timeoutMs = 180000): Promise<ApprovalDecision> => {
    return new Promise((resolve) => {
      this.pending.set(req.id, resolve);
      this.emit('approval', req);
      setTimeout(() => { if (this.pending.has(req.id)) { this.pending.delete(req.id); resolve('deny'); } }, timeoutMs);
    });
  };
  resolveApproval(id: string, decision: ApprovalDecision) {
    const r = this.pending.get(id);
    if (r) { this.pending.delete(id); r(decision); return true; }
    return false;
  }

  async execute(toolId: string, input: any, ctx: ExecContext = {}): Promise<ExecResult> {
    const tool = this.deps.getTool(toolId);
    if (!tool) { this.audit({ toolId, toolName: toolId, providerId: 'unknown', riskLevel: 'high', permission: 'none', approvalRequired: false, approvalDecision: 'n/a', status: 'error', errorMessage: 'unknown tool', skillId: ctx.skillId }); return { ok: false, blocked: true, error: 'Unknown tool.' }; }
    if (tool.future) return this.block(tool, ctx, 'This capability is not available yet (future tool).');
    if (!tool.enabled) return this.block(tool, ctx, 'This tool is disabled.');

    const valid = core.validateInput(tool.inputSchema, input);
    if (!valid.ok) return this.block(tool, ctx, `Invalid input: ${valid.error}`);

    const scan = this.deps.security.scanForInjectionPatterns(`${jsonish(input)} ${ctx.untrustedText || ''}`);
    const severity = ctx.promptRiskSeverity || scan.severity;
    const need = core.approvalNeeded(tool, { mode: ctx.mode || this.deps.approvalMode(), promptRiskSeverity: severity, alwaysAllowed: tool.alwaysAllow });

    let decision: ApprovalDecision | 'auto' = 'auto';
    if (need.required) {
      const req: ApprovalRequest = {
        id: rid(), toolId, toolName: tool.name, description: tool.description, riskLevel: tool.riskLevel, permission: tool.requiredPermission,
        reason: need.reason, inputPreview: this.deps.security.redactPreview(jsonish(input)), promptSeverity: severity,
        canAlwaysAllow: core.canAlwaysAllow(tool), skillId: ctx.skillId,
      };
      const approver = ctx.approver || this.deps.requestApproval;
      decision = await approver(req);
      if (decision === 'deny') {
        const ev = this.audit({ toolId, toolName: tool.name, providerId: tool.providerId, riskLevel: tool.riskLevel, permission: tool.requiredPermission, approvalRequired: true, approvalDecision: 'deny', status: 'denied', skillId: ctx.skillId, input });
        return { ok: false, blocked: true, error: 'Denied by user.', decision: 'deny', auditId: ev.id };
      }
      if (decision === 'always' && core.canAlwaysAllow(tool)) this.deps.setAlwaysAllow?.(toolId, true);
    }

    const t0 = Date.now();
    try {
      const raw = await this.deps.execProvider(tool.providerId, toolId, input);
      const outStr = typeof raw === 'string' ? raw : jsonish(raw);
      const sensitive = !!(tool as any).sensitiveOutput;
      // Secret output is never logged, never wrapped into model context, never returned via the gateway.
      const auditOut = sensitive ? '[secret-redacted]' : outStr;
      const sanitized = sensitive ? '[secret redacted — used only in the tool layer, not exposed to the model]' : this.deps.security.sanitizeToolOutput(outStr, tool.name);
      const psIds: string[] = [];
      if (!sensitive) { const r = this.deps.security.inspect?.(tool.name, outStr, 'tool_output', ctx.skillId || undefined); if (r?.eventId) psIds.push(r.eventId); }
      const ev = this.audit({ toolId, toolName: tool.name, providerId: tool.providerId, riskLevel: tool.riskLevel, permission: tool.requiredPermission, approvalRequired: need.required, approvalDecision: decision, status: 'ok', durationMs: Date.now() - t0, output: auditOut, skillId: ctx.skillId, relatedBrainNodeId: ctx.relatedBrainNodeId, promptSecurityEventIds: psIds });
      return { ok: true, output: sensitive ? undefined : raw, sanitized, decision: String(decision), auditId: ev.id };
    } catch (e: any) {
      const ev = this.audit({ toolId, toolName: tool.name, providerId: tool.providerId, riskLevel: tool.riskLevel, permission: tool.requiredPermission, approvalRequired: need.required, approvalDecision: decision, status: 'error', errorMessage: e?.message || String(e), durationMs: Date.now() - t0, skillId: ctx.skillId });
      return { ok: false, error: this.deps.security.redactPreview(e?.message || 'tool failed'), decision: String(decision), auditId: ev.id };
    }
  }

  private block(tool: EffectiveToolLike, ctx: ExecContext, msg: string): ExecResult {
    const ev = this.audit({ toolId: tool.id, toolName: tool.name, providerId: tool.providerId, riskLevel: tool.riskLevel, permission: tool.requiredPermission, approvalRequired: false, approvalDecision: 'n/a', status: 'blocked', errorMessage: msg, skillId: ctx.skillId });
    return { ok: false, blocked: true, error: msg, auditId: ev.id };
  }

  private audit(inp: any) {
    const ev = core.shapeToolAuditEvent(inp);
    try { this.deps.recordAudit(ev); } catch { /* */ }
    return ev;
  }
}

function jsonish(v: any): string { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return String(v); } }

// --- default singleton (real wiring) ---------------------------------------

// Lazy requires so importing this module (e.g. in pure node tests) never pulls in electron.
function realDeps(): GatewayDeps {
  const reg = () => require('./toolRegistry').default;
  const sec = () => require('../security/promptSecurity').default;
  return {
    getTool: (id) => reg().get(id),
    execProvider: async (providerId, toolId, input) => {
      const p = reg().getProvider(providerId);
      if (!p || !p.enabled) throw new Error('provider unavailable');
      return p.executeTool(toolId, input);
    },
    security: {
      sanitizeToolOutput: (s, n) => sec().sanitizeToolOutput(s, n),
      scanForInjectionPatterns: (s) => sec().scanForInjectionPatterns(s),
      redactPreview: (s, m) => require('../security/promptSecurityCore').redactPreview(s, m),
      inspect: (l, c, t, i) => sec().inspect(l, c, t, i),
    },
    recordAudit: (ev) => reg().recordAudit(ev),
    approvalMode: () => reg().approvalMode(),
    requestApproval: (req) => gateway.defaultRequestApproval(req),
    setAlwaysAllow: (id, val) => reg().setAlwaysAllow(id, val),
  };
}

const gateway = new ToolGateway(realDeps());
export default gateway;
