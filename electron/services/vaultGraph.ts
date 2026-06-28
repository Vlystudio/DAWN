import * as fs from 'fs';
import * as path from 'path';
import logger from './logger';
import vault from './vault';

/**
 * vaultGraph.ts — GraphBuilder. Parses the vault's Markdown (WikiLinks [[x]],
 * #tags, folders, frontmatter type/project) into nodes + edges and exports to
 * Dawn/Graph/brain_graph.json, which can power the visual Brain Explorer.
 */

const SKIP = new Set(['.obsidian', '.trash', 'attachments', '.git', 'node_modules', 'graph']);

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name.toLowerCase())) out = out.concat(walk(full));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

function frontmatterField(text: string, key: string): string | null {
  const fm = text.match(/^---([\s\S]*?)---/);
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

export function build() {
  const root = vault.dawnDir();
  if (!vault.isConnected() || !fs.existsSync(root)) return { ok: false, error: 'No vault connected.' };

  const nodes: any[] = [];
  const edges: any[] = [];
  const seenTags = new Set<string>();
  const titleToId = new Map<string, string>();

  // also scan the whole vault, not just Dawn/, so existing notes are included
  const files = walk(vault.vaultPath());

  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const title = (text.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, '.md')).trim();
    const id = path.relative(vault.vaultPath(), file).replace(/\\/g, '/');
    const type = frontmatterField(text, 'type') || 'note';
    const project = frontmatterField(text, 'project');
    titleToId.set(title.toLowerCase(), id);
    nodes.push({ id, type, title, project, summary: (text.replace(/^---[\s\S]*?---/, '').match(/Summary:\s*\n(.+)/)?.[1] || '').slice(0, 160) });

    // tags
    const tags = new Set<string>();
    (text.match(/(^|\s)#([A-Za-z0-9_/-]+)/g) || []).forEach((t) => tags.add(t.trim().replace(/^#/, '')));
    for (const tag of tags) {
      const tid = `tag:${tag}`;
      if (!seenTags.has(tag)) {
        seenTags.add(tag);
        nodes.push({ id: tid, type: 'tag', title: `#${tag}` });
      }
      edges.push({ source: id, target: tid, type: 'tag' });
    }
    if (project) edges.push({ source: id, target: `project:${project}`, type: 'project' });
  }

  // project nodes
  for (const n of nodes.filter((x) => x.project)) {
    const pid = `project:${n.project}`;
    if (!nodes.find((x) => x.id === pid)) nodes.push({ id: pid, type: 'project', title: n.project });
  }

  // resolve [[WikiLinks]] -> edges
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const id = path.relative(vault.vaultPath(), file).replace(/\\/g, '/');
    const links = text.match(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g) || [];
    for (const l of links) {
      const target = l.replace(/\[\[|\]\]/g, '').split('|')[0].trim().toLowerCase();
      const tid = titleToId.get(target);
      if (tid && tid !== id) edges.push({ source: id, target: tid, type: 'link' });
    }
  }

  const out = { generated: new Date().toISOString(), nodes, edges };
  const dir = path.join(root, 'Graph');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'brain_graph.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  logger.info('vault', `Graph exported: ${nodes.length} nodes, ${edges.length} edges -> Dawn/Graph/brain_graph.json`);
  return { ok: true, nodes: nodes.length, edges: edges.length, path: file };
}

export default { build };
