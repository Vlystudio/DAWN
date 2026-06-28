import React, { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useBrainStore } from '../state/brainStore';
import NeuralNodeField from './NeuralNodeField';
import NeuralConnections from './NeuralConnections';
import BrainConnectome from './BrainConnectome';
import RegionActivity from './RegionActivity';
import BrainCameraControls from './BrainCameraControls';
import BrainNodeDetailsPanel from './BrainNodeDetailsPanel';
import { regionColor } from './BrainState';
import { regionPoint, regionOf } from './brainShape';
import { Button } from '../ui/button';

/** A one-line description of what each node type represents (for hover/inspect). */
function nodeBlurb(node: any): string {
  const meta = (() => { try { return JSON.parse(node.metadata_json || '{}'); } catch { return {}; } })();
  switch (node.type) {
    case 'system_event': return "DAWN's active reasoning core.";
    case 'cluster': return 'A region of DAWN’s mind. Each holds related neurons.';
    case 'conversation': return 'A past conversation. Click to open it.';
    case 'memory': return `A saved ${meta.type || 'memory'} DAWN can recall.`;
    case 'project': return 'One of your projects DAWN tracks.';
    case 'rule': return meta.protected ? 'A protected safety/privacy rule.' : 'A behavior rule you set.';
    case 'tool': return 'A capability DAWN can use.';
    case 'file': return 'An indexed local file in your knowledge base.';
    case 'vault_note': return 'A note from your Obsidian vault.';
    case 'web_source': return 'A web source DAWN used in research.';
    default: return node.type;
  }
}

const TYPE_FILTERS: { type: string; label: string; color: string; area: string }[] = [
  { type: 'conversation', label: 'Conversations', color: regionColor('cyan'), area: 'Language cortex' },
  { type: 'memory', label: 'Memories', color: regionColor('violet'), area: 'Hippocampus' },
  { type: 'project', label: 'Projects', color: regionColor('teal'), area: 'Prefrontal cortex' },
  { type: 'vault_note', label: 'Obsidian Vault', color: regionColor('orange'), area: 'Temporal lobe' },
  { type: 'notion_page', label: 'Notion', color: regionColor('slate'), area: 'Temporal–parietal' },
  { type: 'rule', label: 'Logic & Rules', color: regionColor('amber'), area: 'Dorsolateral PFC' },
  { type: 'tool', label: 'Tools', color: regionColor('blue'), area: 'Cerebellum' },
  { type: 'file', label: 'Knowledge', color: regionColor('green'), area: 'Parietal cortex' },
  { type: 'web_source', label: 'Web Research', color: regionColor('cyan'), area: 'Occipital cortex' },
];

/** Brain Explorer — zoom/pan/rotate the real knowledge graph, click nodes to
 *  inspect, filter by region, search by title. Driven entirely by brain_nodes. */
export default function BrainExplorer({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const graph = useBrainStore((s) => s.graph);
  const loadGraph = useBrainStore((s) => s.loadGraph);
  const growth = useBrainStore((s) => s.growth);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [hover, setHover] = useState<{ node: any; x: number; y: number } | null>(null);

  useEffect(() => {
    // Rebuild from latest data when the Explorer opens (kept off the chat hot path).
    window.dawn.graph.rebuild().then(() => loadGraph());
  }, [loadGraph]);

  useEffect(() => {
    if (selected) window.dawn.graph.node(selected).then(setDetail);
    else setDetail(null);
  }, [selected]);

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  // Place every data node inside the brain volume, in its region's lobe.
  const posMap = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const n of nodes) m.set(n.id, regionPoint(regionOf(n), n.id));
    return m;
  }, [nodes]);

  const highlightIds = useMemo(() => {
    if (!search.trim()) return undefined;
    const q = search.toLowerCase();
    return new Set(nodes.filter((n) => n.title?.toLowerCase().includes(q)).map((n) => n.id));
  }, [search, nodes]);

  const toggle = (type: string) =>
    setFilter((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) c[n.type] = (c[n.type] || 0) + 1;
    return c;
  }, [nodes]);

  async function pin(node: any) {
    const meta = JSON.parse(node.metadata_json || '{}');
    await window.dawn.memory.update(node.source_id, { pinned: meta.pinned ? 0 : 1 });
    await loadGraph();
    window.dawn.graph.node(selected!).then(setDetail);
  }
  async function forget(node: any) {
    if (!confirm('Forget this memory permanently?')) return;
    await window.dawn.memory.remove(node.source_id);
    setSelected(null);
    await loadGraph();
  }
  function openNode(node: any) {
    if (node.source_id) onOpenConversation(node.source_id);
  }

  return (
    <div className="flex h-full">
      {/* Filters */}
      <div className="w-56 shrink-0 border-r border-border p-4 space-y-3 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-ink">Brain Explorer</h2>
          <p className="text-xs text-dim mt-1">A living map of what DAWN knows about you. Click a node to inspect it.</p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the brain…"
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-neural-cyan"
        />
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-faint mb-1">Regions</div>
          {TYPE_FILTERS.map((f) => {
            const on = filter.size === 0 || filter.has(f.type);
            return (
              <button
                key={f.type}
                onClick={() => toggle(f.type)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${on ? 'bg-panel2/60 text-ink' : 'text-faint hover:text-dim'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.color, opacity: on ? 1 : 0.4 }} />
                  <span className="min-w-0">
                    <span className="block truncate leading-tight">{f.label}</span>
                    <span className="block text-[10px] text-faint leading-tight">{f.area}</span>
                  </span>
                </span>
                <span className="text-xs text-faint shrink-0">{counts[f.type] || 0}</span>
              </button>
            );
          })}
          {filter.size > 0 ? (
            <Button size="sm" variant="ghost" className="w-full mt-1" onClick={() => setFilter(new Set())}>
              Show all
            </Button>
          ) : null}
        </div>
        <Button size="sm" variant="glass" className="w-full" onClick={() => window.dawn.graph.rebuild().then(loadGraph)}>
          Rebuild graph
        </Button>
        <div className="text-xs text-faint pt-2 border-t border-border">
          {nodes.length} nodes · {edges.length} connections
        </div>
      </div>

      {/* 3D graph */}
      <div className="flex-1 relative">
        <Canvas
          camera={{ position: [0, 0.3, 9.2], fov: 50 }}
          dpr={[1, 2]}
          onPointerMissed={() => setSelected(null)}
          onCreated={({ scene }) => { scene.fog = new THREE.FogExp2('#0a0703', 0.02); }}
        >
          <color attach="background" args={['#060401']} />
          <ambientLight intensity={0.5} />
          <pointLight position={[0, 0.3, 0]} intensity={1.8} color="#ffb020" />
          <pointLight position={[6, 4, 6]} intensity={0.4} color="#ff7a18" />
          <Stars radius={80} depth={50} count={2200} factor={3} saturation={0} fade speed={0.3} />
          {/* dense brain-shaped fiber connectome (grows with knowledge) */}
          <BrainConnectome growth={growth} />
          <NeuralConnections nodes={nodes} edges={edges} positions={posMap} />
          <NeuralNodeField
            nodes={nodes}
            positions={posMap}
            growth={growth}
            selectedId={selected}
            onSelect={setSelected}
            visibleTypes={filter}
            highlightIds={highlightIds}
            onHover={(node, x, y) => setHover(node ? { node, x, y } : null)}
          />
          <RegionActivity />
          <BrainCameraControls autoRotate={!selected} />
        </Canvas>

        <div className="absolute top-3 left-3 glass-soft px-3 py-1.5 text-xs text-dim pointer-events-none">
          Drag to rotate · scroll to zoom · hover or click a neuron
        </div>

        {hover ? (
          <div
            className="fixed z-30 pointer-events-none glass px-3 py-2 max-w-[260px]"
            style={{ left: Math.min(hover.x + 14, window.innerWidth - 280), top: hover.y + 14 }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: regionColor(hover.node.color_group), boxShadow: `0 0 8px ${regionColor(hover.node.color_group)}` }} />
              <span className="text-xs uppercase tracking-wide text-faint">{hover.node.type.replace('_', ' ')}</span>
            </div>
            <div className="text-sm font-semibold text-ink mt-1 leading-tight">{hover.node.title}</div>
            <div className="text-xs text-dim mt-0.5">{nodeBlurb(hover.node)}</div>
          </div>
        ) : null}

        <BrainNodeDetailsPanel detail={detail} onClose={() => setSelected(null)} onPin={pin} onForget={forget} onOpen={openNode} />
      </div>
    </div>
  );
}
