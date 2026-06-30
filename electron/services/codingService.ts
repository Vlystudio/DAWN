/**
 * codingService.ts — Electron-facing Coding Agent service. Bridges the tested coding engine
 * + orchestrator (electron/services/coding/*) to DAWN: the local model (llama), the per-run
 * approval UI, run tracking, and the renderer. No security logic lives here — it delegates to
 * the workspace-scoped, checkpointed, redacted engine. Fails closed.
 */
import { WebContents } from 'electron';
import * as llama from './llama';
import runtime from './runtime';
import settings from './settings';
import logger from './logger';
import * as eng from './coding/engine';
import { runCodingTask, pickCodingModel, CodingRun } from './coding/coding';
import type { Workspace, CodingMode } from './coding/engine';

let seq = 0;
const newId = () => `cap_${Date.now()}_${seq++}`;
const pendingApprovals = new Map<string, (ok: boolean) => void>();
interface Active { run: CodingRun; signal: { aborted: boolean }; sender: WebContents | null; }
const active = new Map<string, Active>();   // by workspace_id

// --- workspace management (thin pass-through to the engine store) ----------
export function listWorkspaces() { return eng.listWorkspaces(); }
export function addWorkspace(folder: string, opts?: Partial<Workspace>) { return eng.addWorkspace(folder, opts); }
export function updateWorkspace(id: string, patch: Partial<Workspace>) { return eng.updateWorkspace(id, patch); }
export function removeWorkspace(id: string) { return eng.removeWorkspace(id); }

export function workspaceInfo(id: string) {
  const w = eng.getWorkspace(id);
  if (!w) return null;
  const s = settings.get();
  return { ...w, coding_model: pickCodingModel(s) };
}

// --- diff / rollback / sources --------------------------------------------
export function getDiff(workspaceId: string, runId?: string) {
  const w = eng.getWorkspace(workspaceId); if (!w) return { ok: false, diff: '', via: 'none' as const };
  return eng.getDiff(w, runId);
}
export function rollback(workspaceId: string, runId: string) {
  const w = eng.getWorkspace(workspaceId); if (!w) return { ok: false, restored: [], removed: [], reason: 'unknown workspace' };
  return eng.rollback(w, runId);
}
export function status(workspaceId: string): CodingRun | null { return active.get(workspaceId)?.run || null; }

export function cancel(workspaceId: string) {
  const a = active.get(workspaceId); if (a) { a.signal.aborted = true; return { ok: true }; } return { ok: false };
}
export function resolveApproval(id: string, approved: boolean) {
  const fn = pendingApprovals.get(id); if (fn) { pendingApprovals.delete(id); fn(approved); return { ok: true }; } return { ok: false };
}

// --- run a coding task -----------------------------------------------------
export async function run(sender: WebContents | null, workspaceId: string, task: string, modeOverride?: CodingMode): Promise<CodingRun | { ok: false; error: string }> {
  const w = eng.getWorkspace(workspaceId);
  if (!w) return { ok: false, error: 'unknown or untrusted workspace' };
  if (active.has(workspaceId)) return { ok: false, error: 'a coding run is already active for this workspace' };
  const mode: CodingMode = modeOverride || w.mode || 'propose_patch';
  if (mode === 'chat_only') return { ok: false, error: 'this workspace is in chat-only mode' };

  const pick = pickCodingModel(settings.get());
  if (pick.warning) logger.warn('coding', pick.warning);

  const controller = new AbortController();
  const signal = { aborted: false };
  const ac: Active = { run: null as any, signal, sender };
  active.set(workspaceId, ac);

  const s = settings.get();
  const params = { temperature: 0.2, top_p: s.topP ?? 0.9, top_k: s.topK ?? 40, repeat_penalty: s.repeatPenalty ?? 1.1, max_tokens: Math.max(Number(s.maxTokens) || 1024, 4096) };
  const generate = async (messages: { role: string; content: string }[]) => {
    if (signal.aborted) throw new Error('cancelled');
    return llama.chatStream(runtime.baseUrl(), messages as any, params, () => { /* no token stream for coding runs */ }, controller.signal);
  };
  const approve = (kind: string, summary: string) => new Promise<boolean>((resolve) => {
    if (!sender) return resolve(false);                       // headless → fail closed
    const id = newId();
    pendingApprovals.set(id, resolve);
    sender.send('coding:approval', { workspaceId, id, kind, summary });
    setTimeout(() => { if (pendingApprovals.delete(id)) resolve(false); }, 180000);
  });
  const onUpdate = (run: CodingRun) => { ac.run = run; sender?.send('coding:update', run); };

  try {
    runtime.setGenerating(true);
    const run = await runCodingTask(w, task, mode, { generate, approve, onUpdate }, { signal });
    ac.run = run;
    // optional: a security review for risky changes (best-effort, never blocks).
    if (run.files_changed.length && run.risk_flags.some((f) => /sensitive|auth|payment|security/i.test(f))) {
      run.risk_flags.push('security_review_recommended');
    }
    eng.updateWorkspace(w.workspace_id, { last_used_at: new Date().toISOString() } as any);
    sender?.send('coding:update', run);
    return run;
  } catch (e: any) {
    logger.error('coding', `run failed: ${e?.message || e}`);
    return { ok: false, error: String(e?.message || e) };
  } finally {
    runtime.setGenerating(false);
    active.delete(workspaceId);
  }
}

export default {
  listWorkspaces, addWorkspace, updateWorkspace, removeWorkspace, workspaceInfo,
  getDiff, rollback, status, cancel, resolveApproval, run,
};
