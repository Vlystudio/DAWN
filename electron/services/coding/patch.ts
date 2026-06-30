/**
 * coding/patch.ts — pure unified-diff parsing/validation/apply, exact-text edits, and diff
 * generation. Operates on in-memory strings only (the engine reads/writes through the safe
 * path layer). Fails closed: a hunk that doesn't match, an ambiguous edit, a binary patch,
 * or a path escape is rejected rather than guessed.
 */
import { resolveInWorkspace, isEditableText } from './pathsafety';

export type PatchOp = 'modify' | 'create' | 'delete';
export interface Hunk { oldBlock: string[]; newBlock: string[]; }
export interface FilePatch { rel: string; op: PatchOp; binary: boolean; hunks: Hunk[]; }

function strip(p: string): string {
  return String(p || '').replace(/^[ab]\//, '').replace(/^"|"$/g, '').trim();
}

/** Parse a unified diff into per-file patches (supports git + plain unified diffs). */
export function parseUnifiedDiff(patchText: string): { ok: boolean; files?: FilePatch[]; reason?: string } {
  const text = String(patchText || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return { ok: false, reason: 'empty patch' };
  const lines = text.split('\n');
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let oldP = '', newP = '';
  let hunkOld: string[] = [], hunkNew: string[] = [], inHunk = false;

  const closeHunk = () => {
    if (inHunk && cur) cur.hunks.push({ oldBlock: hunkOld, newBlock: hunkNew });
    hunkOld = []; hunkNew = []; inHunk = false;
  };
  const closeFile = () => {
    closeHunk();
    if (cur) {
      const rel = (cur.op === 'delete' ? oldP : newP) || oldP || newP;
      cur.rel = strip(rel);
      if (cur.rel) files.push(cur);
    }
    cur = null; oldP = ''; newP = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('diff --git')) { closeFile(); cur = { rel: '', op: 'modify', binary: false, hunks: [] }; continue; }
    if (/^Binary files .* differ/.test(ln) || /^GIT binary patch/.test(ln)) { if (!cur) cur = { rel: '', op: 'modify', binary: false, hunks: [] }; cur.binary = true; continue; }
    if (ln.startsWith('--- ')) { if (!cur) cur = { rel: '', op: 'modify', binary: false, hunks: [] }; const p = ln.slice(4).trim(); oldP = p; if (p === '/dev/null') cur.op = 'create'; continue; }
    if (ln.startsWith('+++ ')) { if (!cur) cur = { rel: '', op: 'modify', binary: false, hunks: [] }; const p = ln.slice(4).trim(); newP = p; if (p === '/dev/null') cur.op = 'delete'; continue; }
    if (ln.startsWith('@@')) { closeHunk(); inHunk = true; continue; }
    if (inHunk) {
      if (ln.startsWith('+')) hunkNew.push(ln.slice(1));
      else if (ln.startsWith('-')) hunkOld.push(ln.slice(1));
      else if (ln.startsWith('\\')) { /* "\ No newline at end of file" */ }
      else if (ln.startsWith(' ')) { hunkOld.push(ln.slice(1)); hunkNew.push(ln.slice(1)); }
      else { closeHunk(); } // a bare empty/other line ends the hunk (blank context is ' ', not '')
    }
  }
  closeFile();
  if (!files.length) return { ok: false, reason: 'no file sections found in patch' };
  return { ok: true, files };
}

export interface ValidatedPatch { ok: boolean; reason?: string; files?: { rel: string; full: string; op: PatchOp }[]; }

/** Validate every target path is inside the workspace, editable text, and not protected. */
export function validatePatch(patchText: string, workspaceRoot: string): ValidatedPatch {
  const parsed = parseUnifiedDiff(patchText);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const out: { rel: string; full: string; op: PatchOp }[] = [];
  for (const f of parsed.files!) {
    if (f.binary) return { ok: false, reason: `binary patch for '${f.rel}' is not allowed` };
    if (/^([a-zA-Z]:[\\/]|[\\/])/.test(f.rel)) return { ok: false, reason: `absolute path in patch not allowed: ${f.rel}` };
    const r = resolveInWorkspace(workspaceRoot, f.rel);
    if (!r.ok) return { ok: false, reason: `patch target rejected (${f.rel}): ${r.reason}` };
    const e = isEditableText(r.full!);
    if (!e.ok) return { ok: false, reason: `patch target rejected (${f.rel}): ${e.reason}` };
    out.push({ rel: r.rel!, full: r.full!, op: f.op });
  }
  return { ok: true, files: out };
}

/** Count +/- (changed) lines in a patch — used for the max_diff_lines limit. */
export function countChangedLines(patchText: string): number {
  return String(patchText || '').split('\n').filter((l) => (l.startsWith('+') && !l.startsWith('+++')) || (l.startsWith('-') && !l.startsWith('---'))).length;
}

/** Apply a single file's hunks to its current content (block-locate + replace; fail closed). */
export function applyFilePatch(content: string, f: FilePatch): { ok: boolean; content?: string; reason?: string } {
  if (f.op === 'create') {
    const created = f.hunks.flatMap((h) => h.newBlock).join('\n');
    return { ok: true, content: created.endsWith('\n') ? created : created + '\n' };
  }
  let cur = content.replace(/\r\n/g, '\n');
  for (const h of f.hunks) {
    const oldBlock = h.oldBlock.join('\n');
    const newBlock = h.newBlock.join('\n');
    if (oldBlock === '') { // pure insertion with no context — append
      cur = cur.endsWith('\n') || cur === '' ? cur + newBlock + '\n' : cur + '\n' + newBlock + '\n';
      continue;
    }
    const idx = cur.indexOf(oldBlock);
    if (idx === -1) return { ok: false, reason: 'hunk context did not match the current file (patch is stale)' };
    if (cur.indexOf(oldBlock, idx + 1) !== -1 && oldBlock.split('\n').length < 3)
      return { ok: false, reason: 'hunk context is ambiguous (matches multiple locations)' };
    cur = cur.slice(0, idx) + newBlock + cur.slice(idx + oldBlock.length);
  }
  return { ok: true, content: cur };
}

/** Exact-text edits: each old_text must occur exactly once (unless allowMultiple). */
export function applyExactEdits(content: string, edits: { old_text: string; new_text: string }[],
                                opts: { allowMultiple?: boolean } = {}): { ok: boolean; content?: string; reason?: string; applied?: number } {
  let cur = content;
  let applied = 0;
  for (const ed of edits) {
    const oldT = String(ed.old_text ?? '');
    const newT = String(ed.new_text ?? '');
    if (oldT === '') return { ok: false, reason: 'edit has empty old_text' };
    const first = cur.indexOf(oldT);
    if (first === -1) return { ok: false, reason: 'old_text not found in file (no change made)' };
    const second = cur.indexOf(oldT, first + oldT.length);
    if (second !== -1 && !opts.allowMultiple) return { ok: false, reason: 'old_text matches multiple locations — make it more specific' };
    cur = opts.allowMultiple ? cur.split(oldT).join(newT) : cur.slice(0, first) + newT + cur.slice(first + oldT.length);
    applied++;
  }
  return { ok: true, content: cur, applied };
}

// --- unified diff generation (LCS over lines) for fs_get_diff (non-git) -----
export function unifiedDiff(oldText: string, newText: string, relPath: string, context = 3): string {
  const a = oldText.replace(/\r\n/g, '\n').split('\n');
  const b = newText.replace(/\r\n/g, '\n').split('\n');
  if (oldText === newText) return '';
  const ops = lcsDiff(a, b);
  // group into hunks with context
  const hunks: { aStart: number; bStart: number; lines: string[] }[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t === 'eq') { i++; continue; }
    let j = i;
    while (j < ops.length && !(ops[j].t === 'eq' && allEqAhead(ops, j, context * 2))) j++;
    const start = Math.max(0, i - context);
    const end = Math.min(ops.length, j + context);
    const lines: string[] = [];
    let aS = -1, bS = -1, aN = 0, bN = 0;
    for (let k = start; k < end; k++) {
      const op = ops[k];
      if (aS === -1) { aS = op.ai; bS = op.bi; }
      if (op.t === 'eq') { lines.push(' ' + a[op.ai]); aN++; bN++; }
      else if (op.t === 'del') { lines.push('-' + a[op.ai]); aN++; }
      else { lines.push('+' + b[op.bi]); bN++; }
    }
    hunks.push({ aStart: (aS < 0 ? 0 : aS) + 1, bStart: (bS < 0 ? 0 : bS) + 1, lines });
    i = end;
  }
  if (!hunks.length) return '';
  const head = `--- a/${relPath}\n+++ b/${relPath}\n`;
  return head + hunks.map((h) => {
    const aCount = h.lines.filter((l) => l[0] === ' ' || l[0] === '-').length;
    const bCount = h.lines.filter((l) => l[0] === ' ' || l[0] === '+').length;
    return `@@ -${h.aStart},${aCount} +${h.bStart},${bCount} @@\n` + h.lines.join('\n');
  }).join('\n') + '\n';
}

function allEqAhead(ops: DiffOp[], j: number, n: number): boolean {
  for (let k = j; k < Math.min(ops.length, j + n); k++) if (ops[k].t !== 'eq') return false;
  return true;
}

interface DiffOp { t: 'eq' | 'del' | 'add'; ai: number; bi: number; }
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  // DP table of LCS lengths (O(n*m) — fine for source files).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'eq', ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', ai: i, bi: j }); i++; }
    else { ops.push({ t: 'add', ai: i, bi: j }); j++; }
  }
  while (i < n) ops.push({ t: 'del', ai: i++, bi: j });
  while (j < m) ops.push({ t: 'add', ai: i, bi: j++ });
  return ops;
}
