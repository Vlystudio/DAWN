/**
 * coding/engine.ts — the Coding Agent engine: trusted-workspace store, native file-edit
 * tools (write/create/edit/apply_patch/delete/get_diff), checkpoints + rollback, and the
 * safe (argv-only, allowlisted) test/lint/typecheck runner. Built on the pure security core
 * (workspace.ts / pathsafety.ts / patch.ts / commands.ts). Every mutation is workspace-
 * scoped, checkpointed, audited, and secret-redacted. Fails closed.
 *
 * Electron is lazy-required (userData path) so the engine is unit-testable against a temp
 * workspace without an Electron runtime (DAWN_CODING_DATA overrides the data dir).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { redactSecrets } from '../agentos';
import { validateWorkspaceRoot } from './workspace';
import { resolveInWorkspace, protectedReason, looksBinary, isEditableText, isSecretFile, MAX_EDIT_FILE_BYTES } from './pathsafety';
import {
  validatePatch, parseUnifiedDiff, applyFilePatch, applyExactEdits, unifiedDiff, countChangedLines,
} from './patch';
import { parseCommand } from './commands';

// --- types -----------------------------------------------------------------
export type CodingMode = 'chat_only' | 'propose_patch' | 'workspace_autopilot' | 'batch_review';

export interface Workspace {
  workspace_id: string;
  name: string;
  root_path: string;
  created_at: string;
  last_used_at: string;
  trust_level: 'coding_workspace';
  autopilot_enabled: boolean;
  mode: CodingMode;
  is_git: boolean;
  allow_file_create: boolean;
  allow_file_delete: boolean;
  allow_test_commands: boolean;
  max_iterations: number;
  max_files_per_run: number;
  max_diff_lines_per_run: number;
  max_command_seconds: number;
  requires_approval_for_large_diff: boolean;
  requires_approval_for_delete: true;
  created_by: 'local_user';
}

export interface CheckpointFile { rel: string; backup_path: string | null; created_by_run: boolean; deleted_by_run: boolean; }
export interface Checkpoint { checkpoint_id: string; workspace_id: string; run_id: string; created_at: string; workspace_root: string; files: CheckpointFile[]; }

export interface OpResult { ok: boolean; reason?: string; rel?: string; diff?: string; created?: boolean; bytes?: number; }

// --- data dir (lazy electron) ----------------------------------------------
function dataDir(): string {
  let base: string;
  try { base = require('electron').app.getPath('userData'); }
  catch { base = process.env.DAWN_CODING_DATA || path.join(os.tmpdir(), 'dawn-coding'); }
  const d = path.join(base, 'coding');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function log(level: 'info' | 'warn' | 'error', msg: string) {
  try { require('../logger').default[level]('coding', msg); } catch { /* test mode */ }
}
function homeDir(): string { return os.homedir(); }

// --- audit (redacted JSONL) ------------------------------------------------
const AUDIT_KINDS = new Set([
  'coding_run_started', 'workspace_selected', 'workspace_validated', 'project_instructions_loaded',
  'checkpoint_created', 'file_read', 'patch_proposed', 'patch_validated', 'file_written', 'file_edited',
  'file_created', 'file_deleted_to_recycle', 'diff_generated', 'test_command_started', 'test_command_completed',
  'iteration_started', 'iteration_completed', 'approval_required', 'coding_run_completed', 'coding_run_failed',
  'rollback_started', 'rollback_completed',
]);
export function audit(run_id: string, kind: string, detail: Record<string, any> = {}) {
  const ev = { ts: new Date().toISOString(), run_id, kind: AUDIT_KINDS.has(kind) ? kind : 'coding_event:' + kind,
    detail: JSON.parse(redactSecrets(JSON.stringify(detail)).slice(0, 4000)) };
  try { fs.appendFileSync(path.join(dataDir(), 'coding-audit.jsonl'), JSON.stringify(ev) + '\n'); } catch { /* */ }
}
export function auditLogPath(): string { return path.join(dataDir(), 'coding-audit.jsonl'); }

// --- workspace store -------------------------------------------------------
function wsFile(): string { return path.join(dataDir(), 'workspaces.json'); }
export function listWorkspaces(): Workspace[] {
  try { return JSON.parse(fs.readFileSync(wsFile(), 'utf-8')); } catch { return []; }
}
function saveWorkspaces(ws: Workspace[]) {
  const tmp = wsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ws, null, 2), 'utf-8');
  fs.renameSync(tmp, wsFile());
}
export function getWorkspace(id: string): Workspace | null {
  return listWorkspaces().find((w) => w.workspace_id === id) || null;
}
function realRoot(root: string): string {
  try { return fs.realpathSync.native(root); } catch { try { return fs.realpathSync(root); } catch { return path.resolve(root); } }
}

export function addWorkspace(folder: string, opts: Partial<Workspace> = {}): { ok: boolean; workspace?: Workspace; reason?: string } {
  const v = validateWorkspaceRoot(folder, homeDir());
  if (!v.ok) return { ok: false, reason: v.reason };
  const root = realRoot(v.root!);                       // resolve symlinks for the stored root
  // Re-validate the realpath (a symlink could point somewhere protected).
  const v2 = validateWorkspaceRoot(root, homeDir());
  if (!v2.ok) return { ok: false, reason: v2.reason };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { ok: false, reason: 'folder does not exist' };
  const existing = listWorkspaces();
  const dup = existing.find((w) => path.resolve(w.root_path).toLowerCase() === root.toLowerCase());
  if (dup) { dup.last_used_at = new Date().toISOString(); saveWorkspaces(existing); return { ok: true, workspace: dup }; }
  const now = new Date().toISOString();
  const w: Workspace = {
    workspace_id: 'ws_' + crypto.randomBytes(6).toString('hex'),
    name: opts.name || path.basename(root),
    root_path: root, created_at: now, last_used_at: now, trust_level: 'coding_workspace',
    autopilot_enabled: false, mode: 'propose_patch',
    is_git: fs.existsSync(path.join(root, '.git')),
    allow_file_create: true, allow_file_delete: false, allow_test_commands: true,
    max_iterations: 4, max_files_per_run: 20, max_diff_lines_per_run: 600, max_command_seconds: 180,
    requires_approval_for_large_diff: true, requires_approval_for_delete: true, created_by: 'local_user',
    ...opts,
  };
  existing.push(w); saveWorkspaces(existing);
  audit('-', 'workspace_validated', { workspace_id: w.workspace_id, root: w.root_path });
  return { ok: true, workspace: w };
}
export function updateWorkspace(id: string, patch: Partial<Workspace>): Workspace | null {
  const all = listWorkspaces(); const w = all.find((x) => x.workspace_id === id); if (!w) return null;
  // Never allow root_path / trust_level to be mutated through here.
  const { root_path, trust_level, workspace_id, ...safe } = patch as any;
  Object.assign(w, safe, { last_used_at: new Date().toISOString() });
  if (w.max_iterations > 12) w.max_iterations = 12;
  saveWorkspaces(all); return w;
}
export function removeWorkspace(id: string): boolean {
  const all = listWorkspaces(); const next = all.filter((w) => w.workspace_id !== id);
  if (next.length === all.length) return false; saveWorkspaces(next); return true;
}

// --- safe path resolution (lexical + realpath symlink escape check) --------
export function resolvePath(root: string, rel: string): { ok: boolean; full?: string; rel?: string; reason?: string } {
  const r = resolveInWorkspace(root, rel);
  if (!r.ok) return r;
  // Symlink escape: if the parent dir realpath is outside the (real) workspace root, reject.
  try {
    const realWs = realRoot(root);
    const parent = path.dirname(r.full!);
    if (fs.existsSync(parent)) {
      const realParent = realRoot(parent);
      const withSep = realWs.endsWith(path.sep) ? realWs : realWs + path.sep;
      if (realParent !== realWs && !realParent.startsWith(withSep)) return { ok: false, reason: 'symlink escapes the workspace' };
    }
    if (fs.existsSync(r.full!) && fs.lstatSync(r.full!).isSymbolicLink()) {
      const realTarget = realRoot(r.full!);
      const withSep = realWs.endsWith(path.sep) ? realWs : realWs + path.sep;
      if (!realTarget.startsWith(withSep)) return { ok: false, reason: 'symlink target escapes the workspace' };
    }
  } catch { /* fall through with lexical result */ }
  return r;
}

// --- checkpoints -----------------------------------------------------------
function checkpointDir(run_id: string): string { const d = path.join(dataDir(), 'checkpoints', run_id.replace(/[^\w.-]/g, '_')); fs.mkdirSync(d, { recursive: true }); return d; }
function cpFile(run_id: string): string { return path.join(checkpointDir(run_id), 'checkpoint.json'); }

export function createCheckpoint(ws: Workspace, run_id: string): Checkpoint {
  const cp: Checkpoint = { checkpoint_id: 'cp_' + crypto.randomBytes(5).toString('hex'), workspace_id: ws.workspace_id,
    run_id, created_at: new Date().toISOString(), workspace_root: ws.root_path, files: [] };
  fs.writeFileSync(cpFile(run_id), JSON.stringify(cp, null, 2));
  audit(run_id, 'checkpoint_created', { checkpoint_id: cp.checkpoint_id, workspace_id: ws.workspace_id });
  return cp;
}
export function loadCheckpoint(run_id: string): Checkpoint | null {
  try { return JSON.parse(fs.readFileSync(cpFile(run_id), 'utf-8')); } catch { return null; }
}
function saveCheckpoint(cp: Checkpoint) { fs.writeFileSync(cpFile(cp.run_id), JSON.stringify(cp, null, 2)); }

/** Back up a file (once) into the checkpoint before it is first edited/deleted. */
function backupBeforeChange(cp: Checkpoint, full: string, rel: string, opts: { willCreate?: boolean; willDelete?: boolean } = {}) {
  if (cp.files.find((f) => f.rel === rel)) return;        // already tracked this run
  const exists = fs.existsSync(full);
  let backup_path: string | null = null;
  if (exists) {
    backup_path = path.join(checkpointDir(cp.run_id), 'files', rel.replace(/[\\/]/g, '__'));
    fs.mkdirSync(path.dirname(backup_path), { recursive: true });
    fs.copyFileSync(full, backup_path);
  }
  cp.files.push({ rel, backup_path, created_by_run: !!opts.willCreate && !exists, deleted_by_run: !!opts.willDelete });
  saveCheckpoint(cp);
}

// --- diff helpers ----------------------------------------------------------
function safeRead(full: string): string { try { return fs.readFileSync(full, 'utf-8'); } catch { return ''; } }
function makeFileDiff(rel: string, before: string, after: string): string {
  if (before === after) return '';
  return redactSecrets(unifiedDiff(before, after, rel));
}

// --- native edit tools -----------------------------------------------------
function guardWriteTarget(root: string, rel: string): { ok: boolean; full?: string; norm?: string; reason?: string } {
  const r = resolvePath(root, rel);
  if (!r.ok) return { ok: false, reason: r.reason };
  const e = isEditableText(r.full!);
  if (!e.ok) return { ok: false, reason: e.reason };
  return { ok: true, full: r.full!, norm: r.rel! };
}

export function writeFile(ws: Workspace, cp: Checkpoint, rel: string, content: string, overwrite = true): OpResult {
  const g = guardWriteTarget(ws.root_path, rel);
  if (!g.ok) return { ok: false, reason: g.reason };
  const exists = fs.existsSync(g.full!);
  if (exists && !overwrite) return { ok: false, reason: 'file exists (set overwrite to replace it)' };
  if (Buffer.byteLength(content, 'utf-8') > MAX_EDIT_FILE_BYTES) return { ok: false, reason: 'content exceeds max file size' };
  if (looksBinary(Buffer.from(content.slice(0, 4096)))) return { ok: false, reason: 'refusing to write binary content' };
  const before = exists ? safeRead(g.full!) : '';
  backupBeforeChange(cp, g.full!, g.norm!, { willCreate: !exists });
  fs.mkdirSync(path.dirname(g.full!), { recursive: true });
  fs.writeFileSync(g.full!, content, 'utf-8');
  const diff = exists ? makeFileDiff(g.norm!, before, content) : redactSecrets(unifiedDiff('', content, g.norm!));
  audit(cp.run_id, exists ? 'file_written' : 'file_created', { rel: g.norm });
  return { ok: true, rel: g.norm, diff, created: !exists, bytes: Buffer.byteLength(content) };
}

export function createFile(ws: Workspace, cp: Checkpoint, rel: string, content: string, overwrite = false): OpResult {
  const g = guardWriteTarget(ws.root_path, rel);
  if (!g.ok) return { ok: false, reason: g.reason };
  if (fs.existsSync(g.full!) && !overwrite) return { ok: false, reason: 'file already exists (use overwrite to replace)' };
  return writeFile(ws, cp, rel, content, true);
}

export function editFile(ws: Workspace, cp: Checkpoint, rel: string, edits: { old_text: string; new_text: string }[], allowMultiple = false): OpResult {
  const g = guardWriteTarget(ws.root_path, rel);
  if (!g.ok) return { ok: false, reason: g.reason };
  if (!fs.existsSync(g.full!)) return { ok: false, reason: 'file does not exist (use create/write)' };
  const before = safeRead(g.full!);
  const r = applyExactEdits(before, edits, { allowMultiple });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (looksBinary(Buffer.from(r.content!.slice(0, 4096)))) return { ok: false, reason: 'edit would produce binary content' };
  backupBeforeChange(cp, g.full!, g.norm!);
  fs.writeFileSync(g.full!, r.content!, 'utf-8');
  audit(cp.run_id, 'file_edited', { rel: g.norm, edits: edits.length });
  return { ok: true, rel: g.norm, diff: makeFileDiff(g.norm!, before, r.content!) };
}

export function applyPatch(ws: Workspace, cp: Checkpoint, patchText: string, opts: { approvedLargeDiff?: boolean } = {}): { ok: boolean; reason?: string; files?: string[]; diff?: string; requiresApproval?: string } {
  const v = validatePatch(patchText, ws.root_path);
  if (!v.ok) return { ok: false, reason: v.reason };
  audit(cp.run_id, 'patch_validated', { files: v.files!.map((f) => f.rel) });
  if (v.files!.length > ws.max_files_per_run) return { ok: false, reason: `patch touches ${v.files!.length} files (limit ${ws.max_files_per_run})`, requiresApproval: 'too_many_files' };
  const changed = countChangedLines(patchText);
  if (changed > ws.max_diff_lines_per_run && ws.requires_approval_for_large_diff && !opts.approvedLargeDiff)
    return { ok: false, reason: `patch changes ${changed} lines (limit ${ws.max_diff_lines_per_run})`, requiresApproval: 'large_diff' };
  // symlink-escape re-check per file (validatePatch is lexical only)
  for (const f of v.files!) { const rp = resolvePath(ws.root_path, f.rel); if (!rp.ok) return { ok: false, reason: `patch target rejected (${f.rel}): ${rp.reason}` }; }
  const parsed = parseUnifiedDiff(patchText).files!;
  const applied: { rel: string; before: string; after: string; op: string }[] = [];
  for (const fp of parsed) {
    const full = path.resolve(ws.root_path, fp.rel);
    const before = fs.existsSync(full) ? safeRead(full) : '';
    if (fp.op === 'delete') { applied.push({ rel: fp.rel, before, after: '', op: 'delete' }); continue; }
    const res = applyFilePatch(before, fp);
    if (!res.ok) return { ok: false, reason: `cannot apply patch to ${fp.rel}: ${res.reason}` };
    applied.push({ rel: fp.rel, before, after: res.content!, op: fp.op });
  }
  // All validated → checkpoint then write atomically-ish.
  for (const a of applied) { const full = path.resolve(ws.root_path, a.rel); backupBeforeChange(cp, full, a.rel, { willCreate: a.op === 'create', willDelete: a.op === 'delete' }); }
  const diffs: string[] = [];
  for (const a of applied) {
    const full = path.resolve(ws.root_path, a.rel);
    if (a.op === 'delete') { try { fs.rmSync(full, { force: true }); } catch { /* */ } diffs.push(`deleted ${a.rel}`); continue; }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, a.after, 'utf-8');
    diffs.push(makeFileDiff(a.rel, a.before, a.after));
    audit(cp.run_id, a.before ? 'file_edited' : 'file_created', { rel: a.rel });
  }
  return { ok: true, files: applied.map((a) => a.rel), diff: redactSecrets(diffs.filter(Boolean).join('\n')) };
}

export function deleteFile(ws: Workspace, cp: Checkpoint, rel: string): OpResult {
  if (!ws.allow_file_delete) return { ok: false, reason: 'file delete is disabled for this workspace' };
  const r = resolvePath(ws.root_path, rel);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (!fs.existsSync(r.full!)) return { ok: false, reason: 'file does not exist' };
  backupBeforeChange(cp, r.full!, r.rel!, { willDelete: true });   // reversible: backed up in checkpoint
  try { fs.rmSync(r.full!, { force: true }); } catch (e: any) { return { ok: false, reason: e.message }; }
  audit(cp.run_id, 'file_deleted_to_recycle', { rel: r.rel });
  return { ok: true, rel: r.rel, diff: `deleted ${r.rel} (restorable via rollback)` };
}

// --- workspace diff --------------------------------------------------------
export function getDiff(ws: Workspace, run_id?: string): { ok: boolean; diff: string; via: 'git' | 'checkpoint' | 'none'; files?: string[] } {
  if (ws.is_git) {
    const r = runGit(ws.root_path, ['diff', '--no-color']);
    if (r.ok) return { ok: true, diff: redactSecrets(r.stdout).slice(0, 60000), via: 'git' };
  }
  // non-git (or git failed): compare checkpoint backups vs current
  const cp = run_id ? loadCheckpoint(run_id) : null;
  if (!cp) return { ok: true, diff: '', via: 'none' };
  const diffs: string[] = []; const files: string[] = [];
  for (const f of cp.files) {
    const full = path.resolve(ws.root_path, f.rel);
    const before = f.backup_path && fs.existsSync(f.backup_path) ? safeRead(f.backup_path) : '';
    const after = fs.existsSync(full) ? safeRead(full) : '';
    if (before !== after) { diffs.push(makeFileDiff(f.rel, before, after) || `changed ${f.rel}`); files.push(f.rel); }
  }
  return { ok: true, diff: redactSecrets(diffs.join('\n')), via: 'checkpoint', files };
}

// --- rollback --------------------------------------------------------------
export function rollback(ws: Workspace, run_id: string): { ok: boolean; restored: string[]; removed: string[]; reason?: string } {
  const cp = loadCheckpoint(run_id);
  if (!cp) return { ok: false, restored: [], removed: [], reason: 'no checkpoint for this run' };
  audit(run_id, 'rollback_started', { checkpoint_id: cp.checkpoint_id });
  const restored: string[] = []; const removed: string[] = [];
  for (const f of cp.files) {
    const full = path.resolve(ws.root_path, f.rel);
    if (f.created_by_run) { try { if (fs.existsSync(full)) { fs.rmSync(full, { force: true }); removed.push(f.rel); } } catch { /* */ } continue; }
    if (f.backup_path && fs.existsSync(f.backup_path)) { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.copyFileSync(f.backup_path, full); restored.push(f.rel); }
  }
  audit(run_id, 'rollback_completed', { restored: restored.length, removed: removed.length });
  return { ok: true, restored, removed };
}

// --- safe command runner ---------------------------------------------------
export interface CommandResult { ok: boolean; code: number; stdout: string; stderr: string; label?: string; reason?: string; timedOut?: boolean; }
export function runTestCommand(ws: Workspace, command: string | string[], run_id?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (!ws.allow_test_commands) return resolve({ ok: false, code: -1, stdout: '', stderr: '', reason: 'test commands disabled for this workspace' });
    const parsed = parseCommand(command);
    if (!parsed.ok) return resolve({ ok: false, code: -1, stdout: '', stderr: '', reason: parsed.reason });
    if (run_id) audit(run_id, 'test_command_started', { label: parsed.label, argv: parsed.argv });
    // Resolve JS tool shims (npm/npx are .cmd on Windows — run them as `node <cli.js>` so we
    // never need a shell). Fails closed if a safe runner can't be located.
    const res = resolveRunner(parsed.argv![0], parsed.argv!.slice(1));
    if ('error' in res) return resolve({ ok: false, code: -1, stdout: '', stderr: '', reason: res.error, label: parsed.label });
    const { exe, args } = res;
    const timeoutMs = Math.max(10, Math.min(900, ws.max_command_seconds || 180)) * 1000;
    let proc;
    try { proc = spawn(exe, args, { cwd: ws.root_path, windowsHide: true, shell: false }); }
    catch (e: any) { return resolve({ ok: false, code: -1, stdout: '', stderr: String(e?.message || e), reason: 'spawn failed' }); }
    let out = '', err = ''; const cap = 24000; let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch { /* */ } }, timeoutMs);
    proc.stdout?.on('data', (d) => { out += d; if (out.length > cap) out = out.slice(0, cap); });
    proc.stderr?.on('data', (d) => { err += d; if (err.length > cap) err = err.slice(0, cap); });
    proc.on('error', (e) => { clearTimeout(killer); resolve({ ok: false, code: -1, stdout: '', stderr: String(e.message), reason: 'exec error', label: parsed.label }); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      const res: CommandResult = { ok: code === 0 && !timedOut, code: code ?? -1, stdout: redactSecrets(out.trim()), stderr: redactSecrets(err.trim()), label: parsed.label, timedOut };
      if (run_id) audit(run_id, 'test_command_completed', { label: parsed.label, code: res.code, timedOut });
      resolve(res);
    });
  });
}

/** Find an executable on PATH (argv-only; no shell). */
function which(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) { const p = path.join(dir, name + ext); try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; } catch { /* */ } }
  }
  return null;
}
/** Resolve a validated tool to a real argv we can spawn WITHOUT a shell. On Windows, npm/npx
 *  are .cmd shims (un-spawnable without a shell on modern Node) → run them as `node <cli.js>`. */
function resolveRunner(exe: string, args: string[]): { exe: string; args: string[] } | { error: string } {
  const e = exe.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
  if (process.platform !== 'win32') return { exe, args };
  if (['npm', 'npx', 'pnpm', 'yarn'].includes(e)) {
    const node = which('node');
    const shim = which(e);
    const cliRel: Record<string, string> = { npm: 'node_modules/npm/bin/npm-cli.js', npx: 'node_modules/npm/bin/npx-cli.js' };
    if (node && shim && cliRel[e]) {
      const cli = path.join(path.dirname(shim), ...cliRel[e].split('/'));
      if (fs.existsSync(cli)) return { exe: node, args: [cli, ...args] };
    }
    return { error: `could not locate a no-shell runner for '${exe}' on this PC (npm/npx need Node's CLI; pnpm/yarn aren't supported here yet — try npm or a Python project)` };
  }
  // python/pytest/ruff/mypy/tsc/vitest are real .exe — resolve on PATH, else use the bare name.
  return { exe: which(e) || exe, args };
}

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true, shell: false, timeout: 15000 });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e: any) { return { ok: false, stdout: '', stderr: String(e?.message || e) }; }
}

// --- project instruction files --------------------------------------------
const INSTRUCTION_FILES = ['DAWN.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'package.json', 'pyproject.toml',
  'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'vitest.config.ts', 'jest.config.js',
  '.eslintrc.json', '.eslintrc.js', 'playwright.config.ts'];
export function readProjectInstructions(ws: Workspace): { files: string[]; text: string; testCommands: string[] } {
  const found: string[] = []; const chunks: string[] = []; const testCommands: string[] = [];
  for (const name of INSTRUCTION_FILES) {
    const full = path.join(ws.root_path, name);
    try {
      if (fs.existsSync(full) && fs.statSync(full).size < 200_000 && !isSecretFile(full)) {
        const txt = fs.readFileSync(full, 'utf-8');
        found.push(name);
        chunks.push(`### ${name}\n${txt.slice(0, 8000)}`);
        if (name === 'package.json') {
          try { const scripts = JSON.parse(txt).scripts || {}; for (const k of ['test', 'lint', 'typecheck', 'type-check']) if (scripts[k]) testCommands.push(`npm run ${k}`); } catch { /* */ }
        }
        if (name === 'pyproject.toml' && /pytest/.test(txt)) testCommands.push('python -m pytest -q');
      }
    } catch { /* skip */ }
  }
  // keep only allowlisted inferred commands
  const safe = testCommands.filter((c) => parseCommand(c).ok);
  return { files: found, text: redactSecrets(chunks.join('\n\n')).slice(0, 24000), testCommands: [...new Set(safe)] };
}

// --- relevant-file scan (read-only, redacted) ------------------------------
export function scanWorkspaceFiles(ws: Workspace, max = 400): { files: string[] } {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 8) return;
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      const full = path.join(dir, e.name);
      const rel = path.relative(ws.root_path, full).replace(/\\/g, '/');
      if (e.isDirectory()) { if (protectedReason(full) || ['node_modules', '.git', 'dist', 'build', '.next', 'release', 'coverage', '__pycache__', '.venv', 'venv'].includes(e.name.toLowerCase())) continue; walk(full, depth + 1); }
      else if (!protectedReason(full) && isEditableText(full).ok) out.push(rel);
    }
  };
  walk(ws.root_path, 0);
  return { files: out };
}

export function readFileForContext(ws: Workspace, rel: string, maxBytes = 60000): { ok: boolean; text?: string; reason?: string } {
  const r = resolvePath(ws.root_path, rel);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (isSecretFile(r.full!)) return { ok: false, reason: 'secret file — not read' };
  try {
    const buf = fs.readFileSync(r.full!);
    if (looksBinary(buf.subarray(0, 4096))) return { ok: false, reason: 'binary file' };
    audit('-', 'file_read', { rel: r.rel });
    return { ok: true, text: redactSecrets(buf.toString('utf-8').slice(0, maxBytes)) };
  } catch (e: any) { return { ok: false, reason: e.message }; }
}
