/**
 * installCmd.ts — pure, electron-free builders for the `install_software` tool.
 *
 * The chat model supplies a package name / installer path / arguments. Before any command is
 * shown on the approval card or run through PowerShell, we VALIDATE it here to block shell
 * metacharacter injection (`;`, `&`, `|`, `$(`, backticks, newlines, …). The human still
 * approves the exact command — these checks are defense in depth so a crafted model output
 * can't smuggle a second command past the approval preview. Fail closed: anything not
 * provably safe is rejected.
 */

// winget id (Publisher.Package) or a display name: letters/digits/space and . _ + - only.
const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,118}[A-Za-z0-9]$/;
// installer flags only: e.g. /S  /SILENT  /D=C:\Path  INSTALLDIR="C:\x"  -q
const ARGS_RE = /^[A-Za-z0-9 _\-/=.:\\"]*$/;

export interface BuiltCommand { ok: boolean; command?: string; error?: string; }

function dq(s: string): string { return '"' + s.replace(/["`]/g, '') + '"'; }      // double-quote (metachars already rejected)
function psq(s: string): string { return "'" + s.replace(/'/g, "''") + "'"; }       // PowerShell single-quote literal

/** `winget install` for a package id or display name (preferred install path). */
export function buildWingetCommand(name: string, opts: { silent?: boolean } = {}): BuiltCommand {
  const n = String(name || '').trim();
  if (!PKG_RE.test(n)) return { ok: false, error: 'invalid package name — use letters, digits, space and . _ + - only' };
  const byId = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/.test(n);   // Publisher.Package(.Sub) → exact id match
  const selector = byId ? `--id ${dq(n)} --exact` : `--name ${dq(n)}`;
  const silent = opts.silent === false ? '' : ' --silent';
  const command = `winget install ${selector} --accept-package-agreements --accept-source-agreements --disable-interactivity${silent}`
    .replace(/\s+/g, ' ').trim();
  return { ok: true, command };
}

/** `Start-Process` for an already-downloaded installer in the quarantine folder. The PATH is
 *  DAWN-controlled (quarantine dir); only the optional ARGS are model-supplied and validated. */
export function buildRunInstallerCommand(filePath: string, args = '', opts: { wait?: boolean } = {}): BuiltCommand {
  const fp = String(filePath || '').trim();
  if (!fp) return { ok: false, error: 'no installer path' };
  if (!/\.(exe|msi|msix)$/i.test(fp)) return { ok: false, error: 'only .exe / .msi / .msix installers can be run' };
  const a = String(args || '').trim();
  if (a && !ARGS_RE.test(a)) return { ok: false, error: 'installer arguments contain unsafe characters' };
  const argList = a ? ` -ArgumentList ${psq(a)}` : '';
  const wait = opts.wait === false ? '' : ' -Wait';
  return { ok: true, command: `Start-Process -FilePath ${psq(fp)}${argList}${wait}` };
}
