/**
 * coding/workspace.ts — pure validation of whether a folder may become a trusted coding
 * workspace. A workspace must be a NORMAL PROJECT FOLDER, never a drive root, the user
 * profile root, Desktop/Documents roots, AppData, Program Files, Windows/System32, .ssh, a
 * credential/browser-profile folder, or any protected location. Fails closed.
 */
import * as path from 'path';
import { protectedReason } from './pathsafety';

export interface WorkspaceCheck { ok: boolean; reason?: string; root?: string; }

function lc(p: string): string { return p.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, ''); }

/**
 * @param candidate the folder the user selected
 * @param home      the user's home dir (e.g. C:\Users\benma) — injected for testability
 */
export function validateWorkspaceRoot(candidate: string, home: string): WorkspaceCheck {
  const raw = String(candidate || '').trim();
  if (!raw) return { ok: false, reason: 'no folder selected' };
  if (raw.includes('\0')) return { ok: false, reason: 'invalid path' };
  // Bare drive letter ("C:" resolves to the CWD on Windows, not the root) — reject lexically.
  if (/^[a-zA-Z]:[\\/]?$/.test(raw)) return { ok: false, reason: 'a whole drive root cannot be a workspace' };

  const root = path.resolve(raw);
  const l = lc(root);
  const h = lc(home);

  // Drive root: C:\  D:\
  if (/^[a-z]:$/.test(l) || /^[a-z]:\\?$/.test(l)) return { ok: false, reason: 'a whole drive root cannot be a workspace' };

  // Protected OS/credential/VCS area (reuses the edit-boundary deny list).
  const pr = protectedReason(root);
  if (pr) return { ok: false, reason: `cannot use a ${pr} as a workspace` };

  // User profile root and its sensitive top-level folders.
  if (l === h) return { ok: false, reason: 'your user profile root cannot be a workspace — pick a specific project folder' };
  for (const banned of ['appdata', 'application data', 'ntuser.dat']) {
    if (l === h + '\\' + banned || l.startsWith(h + '\\' + banned + '\\')) {
      return { ok: false, reason: `AppData / system profile data cannot be a workspace` };
    }
  }
  // Desktop / Documents / Downloads ROOTS are too broad; a project subfolder under them is fine.
  for (const broad of ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'onedrive']) {
    if (l === h + '\\' + broad) {
      return { ok: false, reason: `the ${broad} root is too broad — pick a specific project subfolder inside it` };
    }
  }
  // Windows special folders by absolute path (defense in depth; protectedReason covers most).
  for (const sys of ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata']) {
    if (l === sys || l.startsWith(sys + '\\')) return { ok: false, reason: 'a system folder cannot be a workspace' };
  }
  // The candidate must not be an ANCESTOR of the home dir (e.g. C:\Users, C:\) — too broad.
  if (h === l || h.startsWith(l + '\\')) return { ok: false, reason: 'this folder contains your user profile — pick a specific project folder' };
  // Must be at least 2 segments deep (not e.g. C:\foo is fine; C: is not — handled above).
  const parts = l.split('\\').filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: 'pick a specific project folder, not a top-level location' };

  return { ok: true, root };
}
