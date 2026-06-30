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
  email: { dir: [0.6, 0.55, -0.6], color: 'blue', title: 'Email' },
  documents: { dir: [-0.2, 0.7, 0.75], color: 'green', title: 'Documents' },
  notes: { dir: [0.85, -0.55, -0.2], color: 'violet', title: 'Notes' },
  tasks: { dir: [-0.45, 0.85, -0.3], color: 'amber', title: 'Tasks' },
  workspace: { dir: [0.2, 0.3, 0.95], color: 'teal', title: 'Workspace' },
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
  // Source ids with a recent medium/high prompt-security event (subtle brain warning flag).
  let secFlagged = new Set<string>();
  try { secFlagged = new Set(db.all("SELECT DISTINCT source_id FROM prompt_security_events WHERE severity IN ('medium','high') AND source_id IS NOT NULL").map((r: any) => r.source_id)); } catch { /* */ }

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
  for (const ws of db.all('SELECT * FROM research_sources ORDER BY used_at DESC LIMIT 150')) {
    const id = `web:${ws.id}`;
    const p = positionFor('web', id);
    addNode({ id, type: 'web_source', title: ws.title || ws.domain || 'Source', summary: ws.url || ws.local_ref, source_id: ws.id, color_group: 'cyan', confidence: ws.reliability ?? 0.5, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ source_type: ws.source_type, reliability: ws.reliability, run_id: ws.run_id }) });
    addEdge('cluster:web', id, 'contains', 0.4);
  }

  // Deep Research runs + reports — each run grows the brain: run → sources,
  // report → run, run → core. Source nodes are created above (research_sources).
  try {
    const runs = db.all('SELECT * FROM research_runs ORDER BY created_at DESC LIMIT 60');
    for (const r of runs) {
      const id = `research:${r.id}`;
      const p = positionFor('web', id);
      addNode({
        id, type: 'research_run', title: truncate(r.question || 'Research', 50), summary: r.question, source_id: r.id,
        color_group: 'cyan', importance: r.status === 'done' ? 0.8 : 0.6,
        position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ status: r.status, depth: r.depth, source_mode: r.source_mode }),
      });
      addEdge('cluster:web', id, 'contains', 0.6);
      addEdge(id, 'core', 'informs', 0.3);
      for (const sc of db.all('SELECT id FROM research_sources WHERE run_id=?', [r.id])) {
        addEdge(`web:${sc.id}`, id, 'sourced', 0.3);
      }
      const rep = db.get('SELECT id,title FROM research_reports WHERE run_id=? ORDER BY created_at DESC LIMIT 1', [r.id]);
      if (rep) {
        const rid = `report:${rep.id}`;
        const pr = positionFor('web', rid);
        addNode({ id: rid, type: 'research_report', title: truncate(rep.title || 'Report', 48), summary: 'Synthesized research report', source_id: rep.id, color_group: 'gold', importance: 0.85, position_x: pr[0], position_y: pr[1], position_z: pr[2] });
        addEdge(rid, id, 'reports', 0.6);
      }
    }
  } catch {
    /* research tables empty / not migrated yet */
  }

  // Documents (Part A) — each local document becomes a node in the Documents region.
  try {
    for (const d of db.all('SELECT id,title,updated_at,length(content) AS size FROM documents WHERE archived=0 ORDER BY updated_at DESC LIMIT 200')) {
      const id = `doc:${d.id}`;
      const p = positionFor('documents', id);
      const flagged = secFlagged.has(d.id);
      addNode({
        id, type: 'document', title: truncate(d.title || 'Untitled', 48), summary: 'Document', source_id: d.id,
        color_group: flagged ? 'red' : 'green', importance: Math.min(1, 0.45 + (d.size || 0) / 8000),
        position_x: p[0], position_y: p[1], position_z: p[2], updated_at: d.updated_at,
        metadata_json: JSON.stringify({ size: d.size, securityFlag: flagged }),
      });
      addEdge('cluster:documents', id, 'contains', 0.5);
      if (flagged) addEdge(id, 'core', 'security_warning', 0.3);
    }
  } catch {
    /* documents table empty */
  }

  // Notes (Part B) → nodes in the Notes region, cross-linked to their explicit links.
  try {
    for (const n of db.all('SELECT id,title,content,updated_at FROM notes WHERE archived=0 ORDER BY updated_at DESC LIMIT 300')) {
      const id = `note:${n.id}`;
      const p = positionFor('notes', id);
      const nflag = secFlagged.has(n.id);
      addNode({ id, type: 'note', title: truncate(n.title || n.content || 'Note', 46), summary: (n.content || '').slice(0, 120), source_id: n.id, color_group: nflag ? 'red' : 'violet', importance: 0.55, position_x: p[0], position_y: p[1], position_z: p[2], updated_at: n.updated_at, metadata_json: JSON.stringify({ securityFlag: nflag }) });
      addEdge('cluster:notes', id, 'contains', 0.5);
      if (nflag) addEdge(id, 'core', 'security_warning', 0.3);
      for (const lk of db.all('SELECT * FROM note_links WHERE note_id=?', [n.id])) {
        const target = lk.target_type === 'memory' ? `mem:${lk.target_id}` : lk.target_type === 'conversation' ? `conv:${lk.target_id}` : lk.target_type === 'task' ? `task:${lk.target_id}` : lk.target_type === 'project' ? `proj:${slug(lk.target_id)}` : '';
        if (target) addEdge(id, target, lk.target_type === 'task' ? 'spawned' : 'about', 0.35);
      }
    }
  } catch { /* notes table empty */ }

  // Tasks (Part B) → nodes in the Tasks region; overdue tasks glow red as a warning.
  try {
    const tnow = Date.now();
    for (const t of db.all("SELECT * FROM tasks WHERE status<>'done' ORDER BY (due_at IS NULL), due_at ASC LIMIT 300")) {
      const id = `task:${t.id}`;
      const p = positionFor('tasks', id);
      const overdue = !!t.due_at && t.due_at < tnow;
      const pri = t.priority === 'urgent' ? 0.95 : t.priority === 'high' ? 0.8 : 0.6;
      addNode({
        id, type: 'task', title: truncate(t.title || 'Task', 46), summary: t.details || '', source_id: t.id,
        color_group: overdue ? 'red' : 'amber', importance: overdue ? 1 : pri,
        position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ status: t.status, priority: t.priority, due_at: t.due_at, overdue }),
      });
      addEdge('cluster:tasks', id, 'contains', 0.5);
      if (overdue) addEdge(id, 'core', 'overdue_warning', 0.4);
    }
  } catch { /* tasks table empty */ }

  // Model benchmarks → Model nodes (Tools region). Faster models glow brighter;
  // compare winners brighten further; failed/OOM benchmarks get a warning edge.
  try {
    const benches = db.all('SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 200');
    const latest = new Map<string, any>();
    for (const b of benches) if (!latest.has(b.model_path)) latest.set(b.model_path, b);
    const winners = new Set(
      db.all("SELECT DISTINCT winner_model FROM compare_runs WHERE winner_model IS NOT NULL AND winner_model<>''").map((r: any) => String(r.winner_model || '').split(/[\\/]/).pop())
    );
    const maxTps = Math.max(1, ...[...latest.values()].map((b) => b.tokens_per_sec || 0));
    for (const b of latest.values()) {
      const id = `model:${slug(b.model_name)}`;
      const p = positionFor('tools', id);
      const ok = b.status === 'ok';
      const won = winners.has(b.model_name);
      const importance = ok ? Math.min(1, 0.45 + 0.5 * ((b.tokens_per_sec || 0) / maxTps) + (won ? 0.2 : 0)) : 0.4;
      addNode({
        id, type: 'model', title: truncate(b.model_name, 40),
        summary: ok ? `${b.tokens_per_sec} tok/s · ${b.backend}` : `failed: ${b.error || (b.oom ? 'OOM' : 'error')}`,
        color_group: ok ? (won ? 'green' : 'blue') : 'amber', importance,
        position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ tokens_per_sec: b.tokens_per_sec, load_ms: b.load_ms, backend: b.backend, gpu_layers: b.gpu_layers, est_max_context: b.est_max_context, quant: b.quant, params_b: b.params_b, oom: !!b.oom, status: b.status, won }),
      });
      addEdge('cluster:tools', id, 'benchmarked', 0.5);
      if (!ok) addEdge(id, 'core', b.oom ? 'oom_warning' : 'error_warning', 0.25);
    }

    // Compare runs → Compare nodes (Logic region), linked to the winning model node.
    for (const r of db.all('SELECT * FROM compare_runs ORDER BY created_at DESC LIMIT 40')) {
      const id = `compare:${r.id}`;
      const p = positionFor('logic', id);
      addNode({
        id, type: 'compare', title: truncate(r.prompt || 'Compare', 46), source_id: r.id,
        summary: r.winner_label ? `winner: Model ${r.winner_label}${r.blind ? ' (blind)' : ''}` : r.status,
        color_group: 'amber', importance: 0.6, position_x: p[0], position_y: p[1], position_z: p[2],
        metadata_json: JSON.stringify({ status: r.status, blind: !!r.blind, winner_label: r.winner_label }),
      });
      addEdge('cluster:logic', id, 'contains', 0.5);
      if (r.winner_model) addEdge(id, `model:${slug(String(r.winner_model).split(/[\\/]/).pop() || '')}`, 'winner', 0.7);
    }
  } catch {
    /* compare/benchmark tables empty */
  }

  // Skills + high-risk registered tools (Part E) → Tools region. Quiet by design:
  // only enabled skills and high/critical enabled tools appear; risky ones glow red.
  try {
    for (const sk of db.all("SELECT id,name,risk_level FROM skills WHERE enabled=1 ORDER BY updated_at DESC LIMIT 60")) {
      const id = `skill:${sk.id}`;
      const p = positionFor('tools', id);
      const risky = sk.risk_level === 'high' || sk.risk_level === 'critical';
      addNode({ id, type: 'skill', title: truncate(sk.name || 'Skill', 40), summary: `skill · ${sk.risk_level}`, source_id: sk.id, color_group: risky ? 'red' : 'blue', importance: risky ? 0.85 : 0.6, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ risk_level: sk.risk_level, warning: risky }) });
      addEdge('cluster:tools', id, 'skill', 0.5);
      if (risky) addEdge(id, 'core', 'high_risk_tool', 0.25);
    }
    const reg = require('./tools/toolRegistry').default;
    for (const tool of reg.list()) {
      if (!tool.enabled || (tool.riskLevel !== 'high' && tool.riskLevel !== 'critical')) continue;
      const id = `regtool:${tool.id}`;
      const p = positionFor('tools', id);
      addNode({ id, type: 'tool', title: truncate(tool.name, 40), summary: `${tool.riskLevel} · ${tool.requiredPermission}`, color_group: tool.riskLevel === 'critical' ? 'red' : 'amber', importance: tool.riskLevel === 'critical' ? 0.9 : 0.75, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ risk_level: tool.riskLevel, permission: tool.requiredPermission, warning: true }) });
      addEdge('cluster:tools', id, 'registered', 0.4);
    }
  } catch { /* registry/skills not ready */ }

  // Email (Part D) — account nodes + a few suspicious/recent message nodes. Never stores
  // bodies or credentials; suspicious messages get a quiet security warning edge.
  try {
    for (const acc of db.all('SELECT id,label,email_address FROM email_accounts ORDER BY created_at ASC LIMIT 20')) {
      const id = `emailacct:${acc.id}`;
      const p = positionFor('email', id);
      addNode({ id, type: 'email_account', title: truncate(acc.label || acc.email_address, 40), summary: 'Email account', source_id: acc.id, color_group: 'blue', importance: 0.7, position_x: p[0], position_y: p[1], position_z: p[2] });
      addEdge('cluster:email', id, 'contains', 0.5);
      const msgs = db.all('SELECT id,subject,prompt_risk_score FROM email_messages WHERE account_id=? ORDER BY (prompt_risk_score IS NULL), prompt_risk_score DESC, date DESC LIMIT 12', [acc.id]);
      for (const m of msgs) {
        const suspicious = (m.prompt_risk_score || 0) >= 25;
        if (!suspicious && msgs.indexOf(m) > 5) continue; // keep it quiet: top few + any suspicious
        const mid = `email:${m.id}`;
        const mp = positionFor('email', mid);
        addNode({ id: mid, type: 'email_message', title: truncate(m.subject || 'Message', 44), summary: 'Email', source_id: m.id, color_group: suspicious ? 'red' : 'blue', importance: suspicious ? 0.85 : 0.5, position_x: mp[0], position_y: mp[1], position_z: mp[2], metadata_json: JSON.stringify({ suspicious, account: acc.id }) });
        addEdge(id, mid, 'message', 0.3);
        if (suspicious) addEdge(mid, 'core', 'security_warning', 0.25);
      }
    }
    // tasks/calendar created from email link back to their source message node.
    for (const t of db.all("SELECT id,source_id FROM tasks WHERE source_type='email' AND source_id IS NOT NULL LIMIT 100")) addEdge(`task:${t.id}`, `email:${t.source_id}`, 'from_email', 0.3);
  } catch { /* email tables empty */ }

  // Security posture (Part G) — one quiet node in the Logic region. No secrets, ever.
  try {
    const authOn = !!s.authEnabled;
    const totpOn = !!(db.get('SELECT totp_enabled FROM auth_config WHERE id=?', ['admin']) as any)?.totp_enabled;
    const vaultCount = (db.get('SELECT COUNT(*) AS n FROM vault_items') as any)?.n || 0;
    const recentFails = (db.get('SELECT COUNT(*) AS n FROM auth_audit WHERE event=? AND success=0 AND ts > ?', ['login_failure', Date.now() - 86400000]) as any)?.n || 0;
    if (authOn || vaultCount > 0) {
      const id = 'security:posture';
      const p = positionFor('logic', id);
      addNode({ id, type: 'security', title: authOn ? (totpOn ? 'Secured (2FA)' : 'Secured') : 'Vault', summary: `${vaultCount} secret(s)`, color_group: recentFails > 3 ? 'red' : 'amber', importance: 0.7, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ authEnabled: authOn, totpEnabled: totpOn, vaultItems: vaultCount, recentFailedLogins: recentFails }) });
      addEdge('cluster:logic', id, 'protects', 0.5);
      if (recentFails > 3) addEdge(id, 'core', 'security_warning', 0.3);
    }
    // Backup/Restore (Part H) — quiet System node; failed restore warns. No secrets/manifests.
    const lastBackup: any = db.get("SELECT created_at FROM backup_history WHERE kind='backup' ORDER BY created_at DESC LIMIT 1");
    const lastRestore: any = db.get("SELECT status,created_at FROM backup_history WHERE kind='restore' ORDER BY created_at DESC LIMIT 1");
    const bcount = (db.get('SELECT COUNT(*) AS n FROM backup_history') as any)?.n || 0;
    if (bcount > 0) {
      const id = 'system:backup';
      const p = positionFor('logic', id);
      const restoreFailed = lastRestore && lastRestore.status === 'error';
      addNode({ id, type: 'system', title: 'Backups', summary: lastBackup ? `last backup ${new Date(lastBackup.created_at).toLocaleDateString()}` : 'no backups', color_group: restoreFailed ? 'red' : 'slate', importance: restoreFailed ? 0.85 : 0.5, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ backups: bcount, lastRestoreStatus: lastRestore?.status || null }) });
      addEdge('cluster:logic', id, 'contains', 0.4);
      if (restoreFailed) addEdge(id, 'core', 'restore_warning', 0.3);
    }
  } catch { /* security/backup tables not present */ }

  // Workspace graph (Phase 2): real workspace items become nodes, links become edges.
  try {
    const wsItems = db.all('SELECT * FROM workspace_items ORDER BY updated_at DESC LIMIT 60');
    const wsIds = new Set<string>(wsItems.map((i: any) => i.id));
    for (const it of wsItems) {
      const nid = `ws:${it.id}`;
      const p = positionFor('workspace', nid);
      addNode({ id: nid, type: 'workspace_item', title: truncate(it.label || it.type, 46), summary: `${it.type} · ${it.source_feature || ''}`.trim(), source_id: it.ref_id || it.id, color_group: 'teal', importance: 0.5, position_x: p[0], position_y: p[1], position_z: p[2], metadata_json: JSON.stringify({ itemType: it.type, sourceFeature: it.source_feature, workspaceItemId: it.id }) });
      addEdge('cluster:workspace', nid, 'contains', 0.4);
    }
    const wsLinks = db.all('SELECT * FROM workspace_links LIMIT 200');
    for (const l of wsLinks) if (wsIds.has(l.from_id) && wsIds.has(l.to_id)) addEdge(`ws:${l.from_id}`, `ws:${l.to_id}`, l.type, 0.5);
  } catch { /* workspace tables not present */ }

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
