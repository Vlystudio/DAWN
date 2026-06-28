import React, { useMemo } from 'react';
import * as THREE from 'three';
import { sampleInterior, sampleSurface, mulberry32 } from './brainShape';
import { growFibers, type Soma, type FiberParams } from './fibers';

/**
 * BrainConnectome — the dense, brain-shaped neural substrate. A faint cortical
 * wireframe shell defines the brain silhouette; inside it, hundreds–thousands of
 * procedural neuron somas each grow hair-thin branching dendrite fibers that
 * interweave into a real connectome. Neuron count + fiber density scale with
 * `growth` (how much DAWN knows) so the brain literally thickens as it ages.
 * All static geometry — generated once per growth level, then just one draw call.
 */

// Warm-dominant palette (gold/amber theme) with cool accents — gives the
// multicolour connectome look while staying on-theme.
const PALETTE: [number, number, number][] = [
  [1.0, 0.69, 0.13], // gold
  [1.0, 0.48, 0.09], // orange
  [1.0, 0.82, 0.48], // light amber
  [1.0, 0.69, 0.13], // gold (weight)
  [0.18, 0.83, 0.75], // teal accent
  [0.22, 0.74, 0.97], // cyan accent
  [0.66, 0.33, 0.97], // violet accent
  [0.2, 0.83, 0.6], // green accent
];

export default function BrainConnectome({ growth }: { growth: number }) {
  const bucket = Math.round(growth * 8); // regenerate at discrete growth levels

  const { shell, fibers, fiberColors, somaPts, somaCols } = useMemo(() => {
    const g = bucket / 8;
    const rng = mulberry32(1337);

    // --- cortical wireframe shell (brain silhouette) ---
    const surf = sampleSurface(1100, rng);
    const sCount = surf.length / 3;
    const shellArr: number[] = [];
    for (let i = 0; i < sCount; i++) {
      const ax = surf[i * 3], ay = surf[i * 3 + 1], az = surf[i * 3 + 2];
      // connect to the 2 nearest neighbours (cheap kNN)
      let n1 = -1, n2 = -1, d1 = Infinity, d2 = Infinity;
      for (let j = 0; j < sCount; j++) {
        if (j === i) continue;
        const dx = ax - surf[j * 3], dy = ay - surf[j * 3 + 1], dz = az - surf[j * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = j; }
        else if (d < d2) { d2 = d; n2 = j; }
      }
      for (const n of [n1, n2]) {
        if (n >= 0 && d1 < 0.6) shellArr.push(ax, ay, az, surf[n * 3], surf[n * 3 + 1], surf[n * 3 + 2]);
      }
    }

    // --- neuron somas + fibers ---
    // A faint background substrate (another ~30% lighter) so the DATA neurons'
    // arbors read clearly. Still grows with knowledge (g rises -> denser).
    const neuronCount = Math.round(74 + g * 416);
    const pts = sampleInterior(neuronCount, rng);
    const nC = pts.length / 3;
    const somas: Soma[] = [];
    const somaPositions = new Float32Array(nC * 3);
    const somaColors = new Float32Array(nC * 3);
    for (let i = 0; i < nC; i++) {
      const col = PALETTE[(rng() * PALETTE.length) | 0];
      const p: [number, number, number] = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
      somas.push({ p, color: col, reach: 0.7 + rng() * 0.6 });
      somaPositions[i * 3] = p[0]; somaPositions[i * 3 + 1] = p[1]; somaPositions[i * 3 + 2] = p[2];
      somaColors[i * 3] = col[0]; somaColors[i * 3 + 1] = col[1]; somaColors[i * 3 + 2] = col[2];
    }

    const params: FiberParams = {
      primaries: 3 + Math.round(g * 2),
      steps: 5 + Math.round(g * 2),
      depth: 2 + Math.round(g * 2),
      branchProb: 0.34,
      jitter: 0.72,
      gravity: 0.05,
    };
    const grown = growFibers(somas, params, rng);

    return {
      shell: new Float32Array(shellArr),
      fibers: grown.positions,
      fiberColors: grown.colors,
      somaPts: somaPositions,
      somaCols: somaColors,
    };
  }, [bucket]);

  return (
    <group>
      {/* cortical wireframe shell */}
      {shell.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[shell, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#bfeaff" transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
      )}

      {/* dense dendrite fibers (per-vertex colour, additive) */}
      {fibers.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[fibers, 3]} />
            <bufferAttribute attach="attributes-color" args={[fiberColors, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors transparent opacity={0.34} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
      )}

      {/* background neuron cell bodies (tiny, faint) */}
      {somaPts.length > 0 && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[somaPts, 3]} />
            <bufferAttribute attach="attributes-color" args={[somaCols, 3]} />
          </bufferGeometry>
          <pointsMaterial size={0.022} vertexColors transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation toneMapped={false} />
        </points>
      )}
    </group>
  );
}
