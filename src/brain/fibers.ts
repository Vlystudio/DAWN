/**
 * fibers.ts — grows dense, thin dendritic FIBERS from neuron somas. Each soma
 * sprouts several primary dendrites that walk outward with jitter, recursively
 * branching into ever-finer twigs, all confined inside the brain volume. Output
 * is one big LineSegments buffer (+ per-vertex colors that taper toward each
 * tip) so tens of thousands of hair-thin fibers render in a single draw call.
 */
import { inside } from './brainShape';

export interface Soma {
  p: [number, number, number];
  color: [number, number, number]; // 0..1 rgb
  reach: number;
}

export interface FiberParams {
  primaries: number; // dendrites per soma
  steps: number; // segments per branch
  depth: number; // recursive branch depth
  branchProb: number;
  jitter: number;
  gravity: number; // slight downward droop
}

function norm(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function growFibers(somas: Soma[], params: FiberParams, rng: () => number) {
  const pos: number[] = [];
  const col: number[] = [];

  const pushSeg = (a: number[], b: number[], color: number[], i: number, steps: number, depth: number) => {
    // Brighter near the soma / lower branches; fades to a dim filament tip.
    const f0 = (1 - (i / steps) * 0.55) * (0.42 + depth * 0.16);
    const f1 = f0 * 0.78;
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(color[0] * f0, color[1] * f0, color[2] * f0, color[0] * f1, color[1] * f1, color[2] * f1);
  };

  const growBranch = (start: number[], dir0: [number, number, number], len: number, depth: number, color: number[]) => {
    let p = start.slice();
    let d = dir0.slice() as number[];
    const steps = params.steps;
    const segLen = len / steps;
    for (let i = 0; i < steps; i++) {
      d = norm([
        d[0] + (rng() - 0.5) * params.jitter,
        d[1] + (rng() - 0.5) * params.jitter - params.gravity,
        d[2] + (rng() - 0.5) * params.jitter,
      ]);
      let np = [p[0] + d[0] * segLen, p[1] + d[1] * segLen, p[2] + d[2] * segLen];
      if (!inside(np[0], np[1], np[2])) {
        // steer back toward the brain interior and try a shorter step
        d = norm([-p[0] * 0.35 + d[0] * 0.5, -p[1] * 0.12 + d[1] * 0.5, -p[2] * 0.35 + d[2] * 0.5]);
        np = [p[0] + d[0] * segLen * 0.6, p[1] + d[1] * segLen * 0.6, p[2] + d[2] * segLen * 0.6];
        if (!inside(np[0], np[1], np[2])) break;
      }
      pushSeg(p, np, color, i, steps, depth);
      p = np;
      if (depth > 0 && i > 0 && rng() < params.branchProb) {
        const child = norm([
          d[0] + (rng() - 0.5) * 1.5,
          d[1] + (rng() - 0.5) * 1.5,
          d[2] + (rng() - 0.5) * 1.5,
        ]);
        growBranch(p, child, len * 0.55, depth - 1, color);
      }
    }
  };

  for (const s of somas) {
    const primaries = params.primaries;
    for (let b = 0; b < primaries; b++) {
      const dir = norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
      growBranch(s.p, dir, s.reach, params.depth, s.color);
    }
  }

  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}
