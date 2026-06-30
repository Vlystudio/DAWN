/**
 * dcd.ts — DAWN's client for D.C.D (Dawn Cyber Defense), the local antivirus console.
 *
 * D.C.D ships a frozen engine (`C:\Program Files\Dawn Cyber Defense\engine\engine.exe`) with a
 * clean JSON CLI (scan / defender / persistence / quarantine / sysstatus / rootkit / …). DAWN
 * drives it by spawning the TRUSTED engine with an ARGV ARRAY (no shell, no interpolation) and
 * parsing the `--json` result. The model picks an OPERATION from a fixed allowlist; DAWN builds
 * the argv — the model never supplies raw engine arguments. Elevated ops (defender harden /
 * realtime / remove-threats, behavior kill, firewall block) run the same frozen engine via
 * `Start-Process -Verb RunAs` (UAC) — never python/cmd, never a user-writable path.
 *
 * Electron-free (effects injected via `deps`) so it is unit-testable in plain Node.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { redactSecrets } from './agentos';

export const DEFAULT_ENGINE = 'C:\\Program Files\\Dawn Cyber Defense\\engine\\engine.exe';

export interface DcdOptions { enginePath?: string; allowElevated?: boolean; }
export interface DcdResult {
  ok: boolean;
  operation: string;
  elevated: boolean;
  json: any | null;
  summary: string;
  error?: string;
  code?: number;
}

export interface DcdDeps {
  spawnJson: (exe: string, args: string[], cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;
  runElevatedJson: (exe: string, args: string[], cwd: string, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;
  pathExists: (p: string) => boolean;
}

// --- operation allowlist ---------------------------------------------------
type Argv = string[] | { error: string };
interface OpSpec { argv: (p: any) => Argv; elevated?: boolean; mutating?: boolean; desc: string; }

const TYPES = ['quick', 'full', 'custom'];
const isType = (t: any) => TYPES.includes(String(t));
const safeStr = (s: any) => { const v = String(s ?? ''); return v && !v.includes('\0') ? v : null; };
const isPid = (n: any) => Number.isInteger(Number(n)) && Number(n) > 0 && Number(n) < 1e7;
const isId = (s: any) => /^[\w.\-:]{1,80}$/.test(String(s ?? ''));
const isIp = (s: any) => /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{3,45}$/.test(String(s ?? ''));

const J = ['--json'];
// ClamAV+YARA `scan`: --type is quick|full; a specific path is `scan --path PATH` (no custom type).
function clamavScanArgv(p: any): Argv {
  const pp = p?.path ? safeStr(p.path) : null;
  const type = p?.type || (pp ? 'custom' : 'quick');
  if (type === 'custom' || pp) {
    if (!pp) return { error: 'a path scan needs a path' };
    return ['scan', '--path', pp, ...J];
  }
  if (!['quick', 'full'].includes(type)) return { error: 'scan type must be quick, full, or a path' };
  return ['scan', '--type', type, ...J];
}
// Microsoft Defender `--scan`: quick|full|custom (custom needs --path).
function defenderScanArgv(p: any): Argv {
  const type = p?.type || 'quick';
  if (!isType(type)) return { error: 'defender scan type must be quick|full|custom' };
  const args = ['defender', '--scan', type];
  if (type === 'custom') { const pp = safeStr(p?.path); if (!pp) return { error: 'custom defender scan needs a path' }; args.push('--path', pp); }
  return [...args, ...J];
}

export const OPERATIONS: Record<string, OpSpec> = {
  // --- read-only (no approval) ---
  status: { argv: () => ['release', '--status', ...J], desc: 'D.C.D engine + ClamAV/YARA status' },
  system_status: { argv: () => ['sysstatus', ...J], desc: 'Defender + firewall + OS status' },
  scan: { argv: (p) => clamavScanArgv(p), desc: 'ClamAV+YARA scan (quick/full, or a specific path)' },
  defender_scan: { argv: (p) => defenderScanArgv(p), desc: 'Microsoft Defender scan (quick/full/custom)' },
  defender_status: { argv: () => ['defender', '--status', ...J], desc: 'Microsoft Defender status' },
  defender_threats: { argv: () => ['defender', '--threats', ...J], desc: 'Defender detected threats' },
  persistence: { argv: () => ['persistence', ...J], desc: 'autoruns / scheduled-task persistence check' },
  netscan: { argv: () => ['netscan', ...J], desc: 'suspicious network connections' },
  rootkit: { argv: () => ['rootkit', ...J], desc: 'rootkit scan' },
  ransomware_status: { argv: () => ['ransomware', '--status', ...J], desc: 'ransomware canary status' },
  ransomware_check: { argv: () => ['ransomware', '--check', ...J], desc: 'check ransomware canaries' },
  behavior_check: { argv: () => ['behavior', '--check', ...J], desc: 'behavioral threat findings' },
  memscan: { argv: (p) => p?.pid != null ? (isPid(p.pid) ? ['memscan', '--pid', String(p.pid), ...J] : { error: 'invalid pid' }) : ['memscan', ...J], desc: 'in-memory malware scan' },
  clamav_status: { argv: () => ['clamav', '--status', ...J], desc: 'ClamAV signature status' },
  yara_status: { argv: () => ['yara', '--status', '--verify', ...J], desc: 'YARA rules status' },
  quarantine_list: { argv: () => ['quarantine', '--list', ...J], desc: 'list quarantined files' },
  schedule_status: { argv: () => ['schedule', '--status', ...J], desc: 'scheduled-scan status' },
  watchdog_status: { argv: () => ['watchdog', '--status', ...J], desc: 'watchdog status' },

  // --- state-changing, NOT elevated (approval-gated) ---
  clamav_update: { argv: () => ['clamav', '--update', ...J], mutating: true, desc: 'update ClamAV signatures' },
  defender_update: { argv: () => ['defender', '--update', ...J], mutating: true, desc: 'update Defender signatures' },
  ransomware_deploy: { argv: () => ['ransomware', '--deploy', ...J], mutating: true, desc: 'deploy ransomware canaries' },
  ransomware_remove: { argv: () => ['ransomware', '--remove', ...J], mutating: true, desc: 'remove ransomware canaries' },
  quarantine_add: { argv: (p) => { const pp = safeStr(p?.path); return pp ? ['quarantine', '--add', pp, '--yes', ...J] : { error: 'quarantine_add needs a path' }; }, mutating: true, desc: 'quarantine a file (reversible)' },
  quarantine_restore: { argv: (p) => isId(p?.id) ? ['quarantine', '--restore', String(p.id), '--yes', ...J] : { error: 'quarantine_restore needs a valid id' }, mutating: true, desc: 'restore a quarantined file' },

  // --- elevated (approval + UAC; trusted frozen engine only) ---
  defender_harden: { argv: () => ['defender', '--harden', ...J], elevated: true, mutating: true, desc: 'apply Defender hardening' },
  defender_realtime: { argv: (p) => ['on', 'off'].includes(String(p?.state)) ? ['defender', '--realtime', String(p.state), ...J] : { error: "realtime state must be 'on' or 'off'" }, elevated: true, mutating: true, desc: 'toggle Defender real-time protection' },
  defender_remove_threats: { argv: () => ['defender', '--remove-threats', ...J], elevated: true, mutating: true, desc: 'remove Defender-detected threats' },
  behavior_kill: { argv: (p) => isPid(p?.pid) ? ['behavior', '--kill', String(p.pid), ...J] : { error: 'behavior_kill needs a valid pid' }, elevated: true, mutating: true, desc: 'kill a suspicious process' },
  firewall_block: { argv: (p) => isIp(p?.ip) ? ['firewall', '--block-ip', String(p.ip), ...J] : { error: 'firewall_block needs a valid IP' }, elevated: true, mutating: true, desc: 'block an IP at the firewall' },
  schedule_install: { argv: () => ['schedule', '--install', ...J], elevated: true, mutating: true, desc: 'install scheduled scans' },
  schedule_remove: { argv: () => ['schedule', '--remove', ...J], elevated: true, mutating: true, desc: 'remove scheduled scans' },
  watchdog_install: { argv: () => ['watchdog', '--install', ...J], elevated: true, mutating: true, desc: 'install the watchdog' },
  watchdog_remove: { argv: () => ['watchdog', '--remove', ...J], elevated: true, mutating: true, desc: 'remove the watchdog' },
};

export function operationInfo(name: string): { exists: boolean; elevated: boolean; mutating: boolean; desc?: string } {
  const op = OPERATIONS[name];
  return { exists: !!op, elevated: !!op?.elevated, mutating: !!op?.mutating, desc: op?.desc };
}
export function listOperations(): { name: string; elevated: boolean; mutating: boolean; desc: string }[] {
  return Object.entries(OPERATIONS).map(([name, o]) => ({ name, elevated: !!o.elevated, mutating: !!o.mutating, desc: o.desc }));
}

// --- engine resolution (TRUSTED — never model-controlled) ------------------
export function resolveEngine(opts: DcdOptions, deps: Pick<DcdDeps, 'pathExists'>): { ok: boolean; exe?: string; dir?: string; reason?: string } {
  const candidates = [opts.enginePath, DEFAULT_ENGINE].filter(Boolean) as string[];
  for (const c of candidates) {
    const base = path.basename(c).toLowerCase();
    // Only ever run the frozen engine binary — never python/cmd/powershell/node.
    if (base !== 'engine.exe') continue;
    if (deps.pathExists(c)) return { ok: true, exe: c, dir: path.dirname(c) };
  }
  return { ok: false, reason: 'D.C.D engine not found. Install Dawn Cyber Defense (engine.exe), or set its path in Settings.' };
}

function parseJson(stdout: string): any | null {
  const lines = (stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].startsWith('{') || lines[i].startsWith('[')) { try { return JSON.parse(lines[i]); } catch { /* keep looking */ } } }
  return null;
}

// --- run an operation ------------------------------------------------------
export async function runOperation(operation: string, params: any = {}, opts: DcdOptions = {}, deps: DcdDeps = realDeps(),
                                   timeoutSeconds = 0): Promise<DcdResult> {
  const spec = OPERATIONS[operation];
  if (!spec) return fail(operation, false, `Unknown D.C.D operation '${operation}'. Allowed: ${Object.keys(OPERATIONS).join(', ')}`);
  if (spec.elevated && opts.allowElevated === false) return fail(operation, true, `'${operation}' needs elevation, which is disabled in settings.`);
  const eng = resolveEngine(opts, deps);
  if (!eng.ok) return fail(operation, !!spec.elevated, eng.reason!);
  const built = spec.argv(params || {});
  if (!Array.isArray(built)) return fail(operation, !!spec.elevated, built.error);
  // long-running scans get a generous default timeout
  const isScan = operation === 'scan' || operation === 'defender_scan';
  const timeoutMs = Math.max(15, Math.min(3600, timeoutSeconds || (isScan ? 1800 : 180))) * 1000;
  try {
    const r = spec.elevated ? await deps.runElevatedJson(eng.exe!, built, eng.dir!, timeoutMs)
                            : await deps.spawnJson(eng.exe!, built, eng.dir!, timeoutMs);
    const json = parseJson(r.stdout);
    if (json == null) return { ok: false, operation, elevated: !!spec.elevated, json: null, code: r.code, error: redactSecrets((r.stderr || r.stdout || `engine exit ${r.code}`)).slice(0, 600), summary: `D.C.D ${operation} returned no parseable result (exit ${r.code}).` };
    const ok = json.ok !== false && (r.code === 0 || isScan);   // scans exit 2 when threats found
    return { ok, operation, elevated: !!spec.elevated, json, code: r.code, summary: summarize(operation, json) };
  } catch (e: any) {
    return fail(operation, !!spec.elevated, redactSecrets(String(e?.message || e)));
  }
}

function fail(operation: string, elevated: boolean, error: string): DcdResult {
  return { ok: false, operation, elevated, json: null, error, summary: `D.C.D ${operation} failed: ${error}` };
}

// --- result summary for chat ----------------------------------------------
function summarize(op: string, j: any): string {
  try {
    if (op === 'scan' || op === 'defender_scan') {
      const sc = j.severity_counts || {};
      const sevs = ['Critical', 'High', 'Medium', 'Low'].map((k) => sc[k] ? `${sc[k]} ${k}` : '').filter(Boolean).join(', ');
      const tf = j.total_findings ?? j.threats_found ?? (Array.isArray(j.findings) ? j.findings.length : 0);
      return `Scanned ${j.files_scanned ?? '?'} file(s) [${(j.tools_used || []).join('+') || op}] — ${tf} finding(s)${sevs ? ' (' + sevs + ')' : ''}.`;
    }
    if (op === 'system_status') { const d = j.defender || {}; return `Defender real-time: ${d.RealTimeProtectionEnabled ? 'ON' : 'OFF'}; firewall profiles: ${(j.firewall || []).map((f: any) => `${f.Name}=${f.Enabled ? 'on' : 'off'}`).join(', ')}.`; }
    if (op === 'status') return `D.C.D ${j.version} (${j.mode}); ClamAV ${j.clamav?.available ? 'ready' : 'unavailable'}, YARA ${j.yara?.available ? 'ready' : 'unavailable'}.`;
    if (op === 'quarantine_list') return `${(j.items || []).length} quarantined item(s).`;
    if (op === 'persistence' || op === 'rootkit' || op === 'behavior_check' || op === 'netscan' || op === 'memscan') { const n = (j.findings || j.total_findings || (Array.isArray(j) ? j.length : 0)); return `${typeof n === 'number' ? n : (j.findings?.length ?? 0)} finding(s).`; }
    if (op === 'defender_threats') return `${(j.threats || []).length} Defender threat(s).`;
    return j.message || (j.ok ? 'done.' : 'completed.');
  } catch { return 'done.'; }
}

export function formatForChat(r: DcdResult): string {
  const L = [`=== D.C.D — ${r.operation}${r.elevated ? ' (elevated)' : ''} ===`];
  L.push(`status: ${r.ok ? 'ok' : 'failed'}`);
  if (r.summary) L.push(r.summary);
  if (r.error) L.push(`error: ${r.error}`);
  // surface top findings if present
  const f = r.json?.findings;
  if (Array.isArray(f) && f.length) {
    L.push(`\nTop findings:`);
    for (const x of f.slice(0, 15)) L.push(`  - [${x.severity || '?'}] ${redactSecrets(String(x.path || x.rule_or_signature || ''))}${x.rule_or_signature ? ` (${x.rule_or_signature})` : ''}`);
  }
  L.push('=== END ===');
  return L.join('\n');
}

// --- real effects ----------------------------------------------------------
function spawnCapture(exe: string, args: string[], cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let proc; try { proc = spawn(exe, args, { cwd, windowsHide: true, shell: false, env: env || process.env }); }
    catch (e: any) { return resolve({ code: -1, stdout: '', stderr: String(e?.message || e) }); }
    let out = '', err = ''; const cap = 400_000;
    const killer = setTimeout(() => { try { proc.kill(); } catch { /* */ } }, timeoutMs);
    proc.stdout?.on('data', (d) => { out += d; if (out.length > cap) out = out.slice(0, cap); });
    proc.stderr?.on('data', (d) => { err += d; if (err.length > cap) err = err.slice(0, cap); });
    proc.on('error', (e: any) => { clearTimeout(killer); resolve({ code: -1, stdout: out, stderr: String(e?.message || e) }); });
    proc.on('close', (code) => { clearTimeout(killer); resolve({ code: code ?? -1, stdout: out, stderr: err }); });
  });
}

/** Run the TRUSTED frozen engine elevated via Start-Process -Verb RunAs, capturing JSON via a
 *  temp file (RunAs can't pipe stdout directly). Engine path must be engine.exe (validated by
 *  resolveEngine) — we never elevate python/cmd/powershell/node or a user-writable path. */
function runElevatedCapture(exe: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (path.basename(exe).toLowerCase() !== 'engine.exe') return resolve({ code: -1, stdout: '', stderr: 'refusing to elevate a non-engine executable' });
    const outFile = path.join(os.tmpdir(), `dcd-${crypto.randomBytes(6).toString('hex')}.json`);
    const psArg = (s: string) => "'" + String(s).replace(/'/g, "''") + "'";
    const argList = args.map(psArg).join(',');
    const script = `$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath ${psArg(exe)} -ArgumentList ${argList} -WorkingDirectory ${psArg(cwd)} -Verb RunAs -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput ${psArg(outFile)}; exit $p.ExitCode } catch { exit 1223 }`;
    let proc; try { proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { cwd, windowsHide: true, shell: false }); }
    catch (e: any) { return resolve({ code: -1, stdout: '', stderr: String(e?.message || e) }); }
    let err = '';
    const killer = setTimeout(() => { try { proc.kill(); } catch { /* */ } }, timeoutMs);
    proc.stderr?.on('data', (d) => { err += d; });
    proc.on('error', (e: any) => { clearTimeout(killer); resolve({ code: -1, stdout: '', stderr: String(e?.message || e) }); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      let stdout = ''; try { stdout = fs.readFileSync(outFile, 'utf-8'); } catch { /* */ }
      try { fs.unlinkSync(outFile); } catch { /* */ }
      const c = code ?? -1;
      resolve({ code: c, stdout, stderr: c === 1223 ? 'user declined the UAC elevation prompt' : err });
    });
  });
}

export function realDeps(): DcdDeps {
  return {
    spawnJson: (exe, args, cwd, t) => spawnCapture(exe, args, cwd, t),
    runElevatedJson: (exe, args, cwd, t) => runElevatedCapture(exe, args, cwd, t),
    pathExists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
  };
}

export default { runOperation, resolveEngine, OPERATIONS, operationInfo, listOperations, formatForChat, realDeps, DEFAULT_ENGINE };
