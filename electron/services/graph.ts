import * as crypto from 'crypto';
import db from './db';
import settings from './settings';

/**
 * graph.ts — builds the BRAIN as a real data graph (brain_nodes + brain_edges)
 * from the user's actual conversations, memories, projects, rules and tools.
 *
 * The 3D brain and the Brain Explorer render THIS data — no decorative fake
 * nodes. Positions are deterministic (hashed from node id) so the layout is
 * stable across rebuilds while still looking organic/clustered per region.
 */

export interface BrainNode {
  id: string; type: string; title: string; summary: string; source_id: string | null;
  created_at: number; updated_at: number; importance: number; confidence: number;
  position_x: number; position_y: number; position_z: number; color_group: string; metadata_json: string;
}
export interface BrainEdge {
  id: string; source_node_id: string; target_node_id: string;
  relationship_type: string; strength: number; created_at: number; metadata_json: string;
}

const newId = () => crypto.randomUUID();

// Brain regions: direction (lobe placement) + color group + label.
export const CLUSTERS: Record<string, { dir: [number, number, number]; color: string; title: string }> = {
  conversations: { dir: [0.25, -0.9, 0.35], color: 'cyan', title: 'Conversations' },
  memories: { dir: [1.0, 0.45, 0.3], color: 'violet', title: 'Memories' },
  knowledge: { dir: [-0.35, -0.5, -0.9], color: 'green', title: 'Local Knowledge' },
  logic: { dir: [-0.95, 0.5, 0.2], color: 'amber', title: 'Logic & Rules' },
  tools: { dir: [0.7, 0.2, -0.85], color: 'blue', title: 'Tools' },
  projects: { dir: [-0.6, -0.7, 0.55], color: 'teal', title: 'Projects' },
  web: { dir: [0.1, 0.95, -0.2], color: 'cyan', title: 'Web Research' },
  vault: { dir: [0.5, -0.3, 0.82], color: 'orange', title: 'Obsidian Vault' },
  notion: { dir: [-0.8, 0.1, -0.55], color: 'slate', title: 'Notion' },
};

const CLUSTER_RADIUS = 3.2;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function positionFor(cluster: string, id: string, spread = 0.95): [number, number, number] {
  const dir = norm(CLUSTERS[cluster].dir);
  const r = mulberry32(hash(id));
  const anchor: [number, number, number] = [dir[0] * CLUSTER_RADIUS, dir[1] * CLUSTER_RADIUS, dir[2] * CLUSTER_RADIUS];
  const j = () => (r() - 0.5) * 2 * spread;
  return [anchor[0] + j(), anchor[1] + j(), anchor[2] + j()];
}

// --- builders ---------------------------------------------------------------

let NODES: BrainNode[] = [];
let EDGES: BrainEdge[] = [];

function addNode(n: Partial<BrainNode> & { id: string; type: string; title: string }) {
  const now = Date.now();
  NODES.push({
    summary: '', source_id: null, created_at: now, updated_at: now,
    importance: 0.5, confidence: 0.8, position_x: 0, position_y: 0, position_z: 0,
    color_group: 'cyan', metadata_json: '{}', ...n,
  } as BrainNode);
}
function addEdge(a: string, b: string, rel: string, strength = 0.5) {
  EDGES.push({ id: newId(), source_node_id: a, target_node_id: b, relationship_type: rel, strength, created_at: Date.now(), metadata_json: '{}' });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Rebuild the whole graph from current data. Cheap at MVP scale. */
export function rebuild() {
  NODES = [];
  EDGES = [];
  const s = settings.get();

  // Core
  addNode({ id: 'core', type: 'system_event', title: 'DAWN Core', summary: 'Active reasoning center', color_group: 'cyan', importance: 1, position_x: 0, position_y: 0, position_z: 0 });

  // Cluster anchors
  for (const [key, c] of Object.entries(CLUSTERS)) {
    const dir = norm(c.dir);
    addNode({
      id: `cluster:${key}`, type: 'cluster', title: c.title, color_group: c.color, importance: 0.9,
      position_x: dir[0] * CLUSTER_RADIUS, position_y: dir[1] * CLUSTER_RADIUS, position_z: dir[2] * CLUSTER_RADIUS,
      metadata_json: JSON.stringify({ cluster: key }),
    });
    addEdge('core', `cluster:${key}`, 'contains', 0.9);
  }

  // Conversations
  const convs = db.all('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?', [Math.min(400, s.nodeLimit)]);
  let prevConv: string | null = null;
  for (const cv of convs) {
    const id = `conv:${cv.id}`;
    const p = positionFor('conversations', id);
    const ageDays = (Date.now() - (cv.updated_at || 0)) / 86400000;
    addNode({
      id, type: 'conversation', title: cv.title || 'Conversation', source_id: cv.id,
      created_at: cv.created_at, updated_at: cv.updated_at,
      importance: cv.pinned ? 1 : Math.max(0.3, 1 - ageDays / 30), color_group: 'cyan',
      position_x: p[0], position_y: p[1], position_z: p[2],
      metadata_json: JSON.stringify({ pinned: !!cv.pinned, model: cv.model }),
    });
    addEdge('cluster:conversations', id, 'contains', 0.5);
    if (prevConv) addEdge(prevConv, id, 'temporal', 0.2);
    prevConv = id;
  }

  // Memories (+ cross-links to projects they mention)
  const mems = db.all('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?', [Math.min(400, s.nodeLimit)]);
  for (const m of mems) {
    const id = `mem:${m.id}`;
    const p = positionFor('memories', id);
    addNode({
      id, type: 'memory', title: truncate(m.content, 48), summary: m.content, source_id: m.id,
      created_at: m.created_at, updated_at: m.created_at, importance: m.pinned ? 1 : m.importance ?? 0.6,
      confidence: m.confidence ?? 0.8, color_group: 'violet',
      position_x: p[0], position_y: p[1], position_z: p[2],
      metadata_json: JSON.stringify({ type: m.type, pinned: !!m.pinned, source: m.source, last_used_at: m.last_used_at }),
    });
    addEdge('cluster:memories', id, 'contains', 0.5);
    for (const proj of s.projects) {
      if (m.content.toLowerCase().includes(proj.toLowerCase().split('/')[0].trim())) {
        addEdge(id, `proj:${slug(proj)}`, 'about', 0.4);
      }
    }
  }

  // Projects (seeded)
  for (const proj of s.projects) {
    const id = `proj:${slug(proj)}`;
    const p = positionFor('projects', id);
    addNode({
      id, type: 'project', title: proj, color_group: 'teal', importance: 0.7,
      position_x: p[0], position_y: p[1], position_z: p[2],
    });
    addEdge('cluster:projects', id, 'contains', 0.5);
  }

  // Logic / Rules
  const RULES = [
    { t: 'Everything runs locally. Never send chats or files to any cloud service.', protected: true, priority: 1 },
    { t: 'Local knowledge is opt-in per folder. Never scan the whole computer.', protected: true, priority: 1 },
    { t: 'Bind local AI ports to localhost; never expose them publicly.', protected: true, priority: 1 },
    { t: 'Never index secrets: .env, SSH/API keys, password vaults, browser profiles, AppData.', protected: true, priority: 1 },
    { t: 'Ask before saving sensitive memories.', protected: true, priority: 2 },
    { t: s.defaultSystemPrompt, protected: false, priority: 3 },
  ];
  for (const r of RULES) {
    const id = `rule:${slug(r.t).slice(0, 40)}`;
    const p = positionFor('logic', id);
    addNode({
      id, type: 'rule', title: truncate(r.t, 50), summary: r.t, color_group: 'amber', importance: r.protected ? 0.9 : 0.6,
      position_x: p[0], position_y: p[1], position_z: p[2],
      metadata_json: JSON.stringify({ protected: r.protected, priority: r.priority, enabled: true }),
    });
    addEdge('cluster:logic', id, 'contains', 0.5);
  }

  // Tools
  const TOOLS = [
    ['Local Chat (Ollama)', 'ollama'], ['Local File Search', 'rag'], ['Web Search', 'web'],
    ['Docker', 'docker'], ['Open WebUI', 'openwebui'], ['SearXNG', 'searxng'],
  ];
  for (const [name, kind] of TOOLS) {
    const id = `tool:${kind}`;
    const p = positionFor('tools', id);
    addNode({ id, type: 'tool', title: name, color_group: 'blue', importance: 0.6, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ kind }) });
    addEdge('cluster:tools', id, 'contains', 0.5);
  }

  // Knowledge (from indexed sources, if any)
  for (const ks of db.all('SELECT * FROM knowledge_sources LIMIT 200')) {
    const id = `file:${ks.id}`;
    const p = positionFor('knowledge', id);
    addNode({ id, type: 'file', title: ks.name || ks.path, summary: ks.path, source_id: ks.id, color_group: 'green', position_x: p[0], position_y: p[1], position_z: p[2] });
    addEdge('cluster:knowledge', id, 'contains', 0.5);
  }

  // Obsidian vault notes — the brain GROWS with your notes. Each indexed note
  // becomes a node in the Vault region, cross-linked to the projects it mentions.
  try {
    const notes = db.all(
      'SELECT path, MAX(title) title, COUNT(*) chunks, MAX(mtime) mtime FROM vault_chunks GROUP BY path ORDER BY mtime DESC LIMIT ?',
      [Math.min(300, s.nodeLimit)]
    );
    for (const nt of notes) {
      const base = String(nt.path || '').split(/[\\/]/).pop() || nt.title || 'Note';
      const id = `vault:${slug(String(nt.path || base))}`;
      const p = positionFor('vault', id);
      addNode({
        id, type: 'vault_note', title: truncate(nt.title || base.replace(/\.md$/i, ''), 48), summary: nt.path,
        color_group: 'orange', importance: Math.min(1, 0.45 + (nt.chunks || 1) / 24),
        position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ path: nt.path, chunks: nt.chunks, source: 'obsidian' }),
      });
      addEdge('cluster:vault', id, 'contains', 0.5);
      for (const proj of s.projects) {
        if (String(nt.title || '').toLowerCase().includes(proj.toLowerCase().split('/')[0].trim())) {
          addEdge(id, `proj:${slug(proj)}`, 'about', 0.4);
        }
      }
    }
  } catch {
    /* vault not indexed yet */
  }

  // Notion pages — DAWN's connected Notion workspace grows the brain too.
  try {
    const pages = db.all(
      'SELECT page_id, MAX(title) title, MAX(url) url, COUNT(*) chunks, MAX(mtime) mtime FROM notion_chunks GROUP BY page_id ORDER BY mtime DESC LIMIT ?',
      [Math.min(300, s.nodeLimit)]
    );
    for (const pg of pages) {
      const id = `notion:${pg.page_id}`;
      const p = positionFor('notion', id);
      addNode({
        id, type: 'notion_page', title: truncate(pg.title || 'Notion page', 48), summary: pg.url,
        color_group: 'slate', importance: Math.min(1, 0.45 + (pg.chunks || 1) / 24),
        position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ url: pg.url, chunks: pg.chunks, source: 'notion' }),
      });
      addEdge('cluster:notion', id, 'contains', 0.5);
    }
  } catch {
    /* notion not connected */
  }

  // Web research (from used sources, if any)
  for (const ws of db.all('SELECT * FROM research_sources ORDER BY used_at DESC LIMIT 100')) {
    const id = `web:${ws.id}`;
    const p = positionFor('web', id);
    addNode({ id, type: 'web_source', title: ws.title || ws.domain, summary: ws.url, source_id: ws.id, color_group: 'cyan', confidence: ws.reliability ?? 0.5, position_x: p[0], position_y: p[1], position_z: p[2] });
    addEdge('cluster:web', id, 'contains', 0.4);
  }

  // Persist
  db.run('DELETE FROM brain_nodes');
  db.run('DELETE FROM brain_edges');
  for (const n of NODES) {
    db.run(
      'INSERT INTO brain_nodes (id,type,title,summary,source_id,created_at,updated_at,importance,confidence,position_x,position_y,position_z,color_group,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [n.id, n.type, n.title, n.summary, n.source_id, n.created_at, n.updated_at, n.importance, n.confidence, n.position_x, n.position_y, n.position_z, n.color_group, n.metadata_json]
    );
  }
  for (const e of EDGES) {
    db.run(
      'INSERT INTO brain_edges (id,source_node_id,target_node_id,relationship_type,strength,created_at,metadata_json) VALUES (?,?,?,?,?,?,?)',
      [e.id, e.source_node_id, e.target_node_id, e.relationship_type, e.strength, e.created_at, e.metadata_json]
    );
  }
  db.saveNow();
  return { nodes: NODES.length, edges: EDGES.length };
}

export function getGraph(): { nodes: BrainNode[]; edges: BrainEdge[] } {
  const nodes = db.all<BrainNode>('SELECT * FROM brain_nodes');
  if (!nodes.length) {
    rebuild();
    return { nodes: db.all<BrainNode>('SELECT * FROM brain_nodes'), edges: db.all<BrainEdge>('SELECT * FROM brain_edges') };
  }
  return { nodes, edges: db.all<BrainEdge>('SELECT * FROM brain_edges') };
}

/** Detail for a single node (Explorer click) + its related nodes. */
export function getNodeDetail(id: string) {
  const node = db.get<BrainNode>('SELECT * FROM brain_nodes WHERE id=?', [id]);
  if (!node) return null;
  const edges = db.all<BrainEdge>('SELECT * FROM brain_edges WHERE source_node_id=? OR target_node_id=?', [id, id]);
  const relatedIds = edges.map((e) => (e.source_node_id === id ? e.target_node_id : e.source_node_id));
  const related = relatedIds.length
    ? db.all<BrainNode>(`SELECT id,type,title,color_group FROM brain_nodes WHERE id IN (${relatedIds.map(() => '?').join(',')})`, relatedIds)
    : [];
  return { node, related };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default { rebuild, getGraph, getNodeDetail, CLUSTERS };
