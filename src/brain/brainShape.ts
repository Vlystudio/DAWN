/**
 * brainShape.ts — a procedural, anatomically-suggestive BRAIN VOLUME used by the
 * connectome. The brain is the union of several ellipsoids (two cerebral
 * hemispheres, two temporal lobes, a cerebellum and a brain-stem) carved by a
 * central sagittal fissure. We sample points on its surface (for the wireframe
 * shell) and inside its volume (for neuron somas + fiber attractors) so the
 * whole neural mass takes the shape of a real brain — and can be regrown denser
 * as DAWN ages. Deterministic via a seeded RNG so the layout is stable.
 */

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ellipsoid = { c: [number, number, number]; r: [number, number, number] };

// +y up, +z forward (front of the brain). Tuned to read as a brain silhouette.
const PARTS: Ellipsoid[] = [
  { c: [-0.95, 0.45, 0.1], r: [1.5, 1.45, 2.55] }, // left hemisphere
  { c: [0.95, 0.45, 0.1], r: [1.5, 1.45, 2.55] }, // right hemisphere
  { c: [-1.15, -0.7, 0.7], r: [0.95, 0.72, 1.75] }, // left temporal lobe
  { c: [1.15, -0.7, 0.7], r: [0.95, 0.72, 1.75] }, // right temporal lobe
  { c: [0.0, -1.15, -1.95], r: [1.35, 0.85, 1.05] }, // cerebellum
  { c: [0.0, -1.75, -1.15], r: [0.34, 0.72, 0.34] }, // brain stem
];

export const BRAIN_BOUNDS = { min: [-2.9, -2.7, -3.0], max: [2.9, 2.2, 3.1] } as const;

function ellipsoidSdf(p: number[], e: Ellipsoid): number {
  const dx = (p[0] - e.c[0]) / e.r[0];
  const dy = (p[1] - e.c[1]) / e.r[1];
  const dz = (p[2] - e.c[2]) / e.r[2];
  const k = Math.min(e.r[0], e.r[1], e.r[2]);
  return (Math.hypot(dx, dy, dz) - 1) * k;
}

export function sdf(x: number, y: number, z: number): number {
  const p = [x, y, z];
  let m = Infinity;
  for (const e of PARTS) m = Math.min(m, ellipsoidSdf(p, e));
  return m;
}

/** Inside the brain volume, with the longitudinal fissure carved on top. */
export function inside(x: number, y: number, z: number): boolean {
  if (sdf(x, y, z) >= 0) return false;
  // central sagittal fissure: thin the midline on the upper cerebrum.
  if (Math.abs(x) < 0.16 && y > 0.35 && z > -1.6) return false;
  return true;
}

/** Random interior points (somas / fiber attractors). */
export function sampleInterior(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 3);
  const { min, max } = BRAIN_BOUNDS;
  let i = 0;
  let guard = 0;
  while (i < count && guard < count * 40) {
    guard++;
    const x = min[0] + rng() * (max[0] - min[0]);
    const y = min[1] + rng() * (max[1] - min[1]);
    const z = min[2] + rng() * (max[2] - min[2]);
    if (sdf(x, y, z) < -0.12 && inside(x, y, z)) {
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
      i++;
    }
  }
  return out.subarray(0, i * 3);
}

/** Random points in a thin shell at the cortical surface (for the wireframe). */
export function sampleSurface(count: number, rng: () => number): Float32Array {
  const out = new Float32Array(count * 3);
  const { min, max } = BRAIN_BOUNDS;
  let i = 0;
  let guard = 0;
  while (i < count && guard < count * 60) {
    guard++;
    const x = min[0] + rng() * (max[0] - min[0]);
    const y = min[1] + rng() * (max[1] - min[1]);
    const z = min[2] + rng() * (max[2] - min[2]);
    const d = sdf(x, y, z);
    if (d > -0.16 && d < 0.04 && inside(x, y + 0.02, z)) {
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
      i++;
    }
  }
  return out.subarray(0, i * 3);
}

// Region anchor directions placed by REAL brain function — each of DAWN's
// subjects sits in the lobe that biologically does that job. (+x right, +y up,
// +z front.)
export const REGION_DIR: Record<string, [number, number, number]> = {
  core: [0, 0.25, 0], // thalamus / central relay
  projects: [0.2, 0.45, 1.0], // prefrontal cortex — planning / goals
  logic: [0.6, 0.55, 0.8], // dorsolateral PFC — reasoning / rules
  conversations: [-0.85, 0.05, 0.65], // Broca's / left frontal — language
  memories: [-0.5, -0.55, 0.05], // hippocampus / left medial temporal — memory
  vault: [1.0, -0.4, 0.45], // right temporal lobe — long-term knowledge store
  knowledge: [0.2, 0.85, -0.5], // parietal cortex — information integration
  web: [0.0, 0.2, -1.05], // occipital cortex — vision / outward search
  tools: [0.0, -0.6, -1.05], // cerebellum — procedural skills / "how-to"
  notion: [-0.8, 0.1, -0.55], // left temporal-parietal — documents / knowledge base
};

// Human-readable anatomical area for each region (shown in the UI).
export const BRAIN_AREA: Record<string, string> = {
  core: 'Thalamus · core',
  projects: 'Prefrontal cortex · planning',
  logic: 'Dorsolateral PFC · reasoning',
  conversations: 'Language cortex · Broca/Wernicke',
  memories: 'Hippocampus · memory',
  vault: 'Temporal lobe · knowledge store',
  knowledge: 'Parietal cortex · integration',
  web: 'Occipital cortex · vision/search',
  tools: 'Cerebellum · skills',
  notion: 'Temporal–parietal · documents',
};

/** An interior brain point biased toward a region, stable per id. */
export function regionPoint(region: string, id: string): [number, number, number] {
  const dir = REGION_DIR[region] || [0, 0.2, 0];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const u: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
  const rng = mulberry32(hash(id));
  // Start near the cortex in that direction, then jitter inward until inside.
  for (let t = 0; t < 24; t++) {
    const rad = 1.6 + rng() * 1.3;
    const jx = (rng() - 0.5) * 1.1;
    const jy = (rng() - 0.5) * 1.1;
    const jz = (rng() - 0.5) * 1.1;
    const p: [number, number, number] = [u[0] * rad + jx, 0.3 + u[1] * rad + jy, u[2] * rad + jz];
    if (inside(p[0], p[1], p[2])) return p;
  }
  return [u[0] * 1.6, 0.3 + u[1] * 1.6, u[2] * 1.6];
}

export function regionOf(node: { id: string; type: string }): string {
  if (node.id === 'core') return 'core';
  if (node.id.startsWith('cluster:')) return node.id.slice(8);
  const map: Record<string, string> = {
    conversation: 'conversations', memory: 'memories', project: 'projects',
    vault_note: 'vault', notion_page: 'notion', rule: 'logic', tool: 'tools', file: 'knowledge', web_source: 'web',
  };
  return map[node.type] || 'core';
}
