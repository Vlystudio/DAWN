import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { shell } from 'electron';
import settings from './settings';
import logger from './logger';

/**
 * vault.ts — VaultManager + MarkdownWriter for Obsidian integration.
 *
 * Treats an Obsidian vault as a plain local folder (Obsidian need not be
 * running). DAWN writes memories/conversations/daily/project notes as Markdown
 * with YAML frontmatter, [[backlinks]] and #tags, de-duplicates by appending
 * timestamped updates instead of creating duplicates, and redacts secrets.
 * Fully local — vault contents never leave the machine.
 */

export const DAWN_ROOT = 'Dawn';
export const FOLDERS = [
  'Inbox', 'Daily',
  'Memories/Personal', 'Memories/Projects', 'Memories/Work', 'Memories/Health',
  'Memories/Gardening', 'Memories/Beekeeping', 'Memories/Photography', 'Memories/Finance', 'Memories/AI', 'Memories/Code',
  'Projects/Dawn', 'Projects/Daybreak', 'Projects/Grocery AI', 'Projects/Beekeeping Software', 'Projects/Home AI',
  'Conversations', 'Decisions', 'Tasks', 'People', 'Systems', 'Research', 'Attachments', 'Graph',
];

// --- paths ------------------------------------------------------------------

export function vaultPath() {
  return settings.get().vaultPath;
}
export function dawnDir() {
  return path.join(vaultPath(), DAWN_ROOT);
}
export function isConnected() {
  const p = vaultPath();
  return !!p && fs.existsSync(p);
}

/** Create the recommended Dawn/ folder structure + Index.md (idempotent). */
export function createStructure() {
  const root = dawnDir();
  for (const f of FOLDERS) fs.mkdirSync(path.join(root, f), { recursive: true });
  const index = path.join(root, 'Index.md');
  if (!fs.existsSync(index)) {
    fs.writeFileSync(index, `# DAWN Knowledge Base\n\nThis folder is managed by DAWN — your local AI's long-term memory.\n\n- [[Dawn]] · [[Local AI]] · [[Brain Explorer]]\n- Memories, Conversations, Projects, Decisions, Tasks and Daily notes live in subfolders.\n\n> Everything here is local Markdown. DAWN reads and writes these notes; nothing is uploaded.\n`);
  }
  logger.info('vault', `Vault structure ensured at ${root}`);
  return { ok: true };
}

export function connect(folder: string) {
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Folder not found.' };
  settings.save({ vaultPath: folder, obsidianEnabled: true });
  createStructure();
  return { ok: true };
}

export function test() {
  const p = vaultPath();
  if (!p) return { ok: false, error: 'No vault selected.' };
  if (!fs.existsSync(p)) return { ok: false, error: 'Vault folder does not exist.' };
  try {
    const probe = path.join(dawnDir(), '.dawn-write-test');
    fs.mkdirSync(dawnDir(), { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { ok: true, path: p };
  } catch (e: any) {
    return { ok: false, error: `Not writable: ${e.message}` };
  }
}

export function openVault() {
  return shell.openPath(isConnected() ? dawnDir() : vaultPath());
}
export function openNote(rel: string) {
  return shell.openPath(path.join(dawnDir(), rel));
}

// --- secret detection -------------------------------------------------------

const SECRET_PATTERNS: { type: string; re: RegExp }[] = [
  { type: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'api key', re: /\b(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  { type: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
  { type: 'password', re: /\b(password|passwd|pwd|secret|token)\s*[:=]\s*\S{4,}/gi },
  { type: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'credit card', re: /\b(?:\d[ -]?){13,16}\b/g },
];

export function detectSecrets(text: string): string[] {
  const found = new Set<string>();
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) found.add(p.type);
  return [...found];
}

function redactSecrets(text: string): string {
  let t = text;
  for (const p of SECRET_PATTERNS) t = t.replace(p.re, `[REDACTED ${p.type}]`);
  return t;
}

// --- MarkdownWriter ---------------------------------------------------------

function slug(s: string) {
  return (s || 'note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function frontmatter(obj: Record<string, any>) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

const CATEGORY_FOLDER: Record<string, string> = {
  personal: 'Memories/Personal', project: 'Memories/Projects', work: 'Memories/Work', health: 'Memories/Health',
  gardening: 'Memories/Gardening', beekeeping: 'Memories/Beekeeping', photography: 'Memories/Photography',
  finance: 'Memories/Finance', ai: 'Memories/AI', code: 'Memories/Code',
};

export interface MemoryNote {
  title: string;
  summary: string;
  details?: string;
  category?: string;
  project?: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  excerpt?: string;
  related?: string[];
  tasks?: string[];
  allowSecrets?: boolean;
}

/** Write (or update) a memory note. Returns the vault-relative path. */
export function writeMemory(m: MemoryNote): { ok: boolean; path?: string; error?: string; redacted?: string[] } {
  if (!isConnected()) return { ok: false, error: 'No vault connected.' };
  const cat = (m.category || 'personal').toLowerCase();
  const folder = CATEGORY_FOLDER[cat] || 'Memories/Personal';
  const dir = path.join(dawnDir(), folder);
  fs.mkdirSync(dir, { recursive: true });

  // Secret handling
  let redacted: string[] = [];
  const safe = (txt?: string) => {
    if (!txt) return txt || '';
    if (settings.get().vaultSecretDetection && !m.allowSecrets) {
      const s = detectSecrets(txt);
      if (s.length) {
        redacted.push(...s);
        return redactSecrets(txt);
      }
    }
    return txt;
  };
  const summary = safe(m.summary);
  const details = safe(m.details);
  const excerpt = safe(m.excerpt);

  const file = path.join(dir, slug(m.title) + '.md');
  const rel = path.relative(dawnDir(), file);

  // Dedup: if the note already exists, append a timestamped update (preserve history).
  if (fs.existsSync(file)) {
    const block = `\n\n## Update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n${summary}${details ? '\n\n' + details : ''}`;
    fs.appendFileSync(file, block);
    logger.info('vault', `Updated memory: ${rel}`);
    return { ok: true, path: rel, redacted: redacted.length ? [...new Set(redacted)] : undefined };
  }

  const tags = [...new Set([...(m.tags || []), cat, m.project ? slug(m.project) : '', 'dawn'].filter(Boolean))];
  const fm = frontmatter({
    type: 'memory', category: cat, project: m.project, created: today(),
    source: m.source || 'dawn-chat', confidence: m.confidence ?? 0.8, tags,
  });
  const related = (m.related || []).concat(m.project ? [m.project] : []);
  const body =
    `# ${m.title}\n\n` +
    `Summary:\n${summary}\n` +
    (details ? `\nDetails:\n${details}\n` : '') +
    (excerpt ? `\n> ${excerpt}\n` : '') +
    (related.length ? `\nRelated:\n${related.map((r) => `- [[${r}]]`).join('\n')}\n` : '') +
    (m.tasks?.length ? `\nTasks:\n${m.tasks.map((t) => `- [ ] ${t}`).join('\n')}\n` : '');
  fs.writeFileSync(file, fm + body);
  logger.info('vault', `Wrote memory: ${rel}`);
  return { ok: true, path: rel, redacted: redacted.length ? [...new Set(redacted)] : undefined };
}

/** Write a conversation summary note. */
export function writeConversation(title: string, model: string, transcript: string, summary: string, sourceId: string) {
  if (!isConnected()) return { ok: false, error: 'No vault connected.' };
  const dir = path.join(dawnDir(), 'Conversations');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today()}-${slug(title)}.md`);
  const rel = path.relative(dawnDir(), file);
  const secure = settings.get().vaultSecretDetection ? redactSecrets(transcript) : transcript;
  const fm = frontmatter({ type: 'conversation', created: today(), source: 'dawn-chat', conversation_id: sourceId, model, tags: ['dawn', 'conversation'] });
  fs.writeFileSync(file, fm + `# ${title}\n\nSummary:\n${summary || '(no summary)'}\n\nRelated:\n- [[Dawn]]\n\n---\n\n## Transcript\n\n${secure}\n`);
  logger.info('vault', `Wrote conversation: ${rel}`);
  return { ok: true, path: rel };
}

/** Append to today's daily note. */
export function appendDaily(line: string) {
  if (!isConnected()) return { ok: false };
  const dir = path.join(dawnDir(), 'Daily');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today()}.md`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, frontmatter({ type: 'daily', created: today(), tags: ['dawn', 'daily'] }) + `# ${today()}\n\n`);
  }
  fs.appendFileSync(file, `- ${line}\n`);
  return { ok: true, path: path.relative(dawnDir(), file) };
}

/** Create/update a project Index.md. */
export function writeProjectIndex(project: string, fields: { goal?: string; status?: string; note?: string }) {
  if (!isConnected()) return { ok: false };
  const dir = path.join(dawnDir(), 'Projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Index.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      frontmatter({ type: 'project', project, created: today(), tags: ['dawn', 'project', slug(project)] }) +
        `# ${project}\n\n## Goal\n${fields.goal || ''}\n\n## Current status\n${fields.status || ''}\n\n## Architecture\n\n## Decisions\n\n## Open tasks\n\n## Bugs\n\n## Related\n- [[Dawn]]\n\n## Timeline\n`
    );
  }
  if (fields.note) fs.appendFileSync(file, `\n- ${new Date().toISOString().slice(0, 10)}: ${fields.note}`);
  return { ok: true, path: path.relative(dawnDir(), file) };
}

export default {
  FOLDERS, vaultPath, dawnDir, isConnected, createStructure, connect, test, openVault, openNote,
  detectSecrets, writeMemory, writeConversation, appendDaily, writeProjectIndex,
};
