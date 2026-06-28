import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * BrainParticles — the hero brain's living golden ENERGY SWARM. A dense, slowly
 * churning cloud of points with flowing synapse filaments and a hot core. It
 * breathes, and it FIRES: bright flares ripple across it like neurons, with the
 * rate/intensity rising the harder DAWN is thinking (derived from the live vis
 * state). No rigid globe — organic and alive. Driven by the `vis` ref.
 */

const GOLD: [number, number, number] = [1.0, 0.69, 0.16];

export default function BrainParticles({ vis, lowPerf, growth = 0 }: { vis: any; lowPerf: boolean; growth?: number }) {
  const group = useRef<any>();
  const ptsGeo = useRef<THREE.BufferGeometry>(null);
  const ptsMat = useRef<any>();
  const lineMat = useRef<any>();
  const fires = useRef<{ i: number; t0: number }[]>([]);

  const count = lowPerf ? 1400 : 3200;

  const { positions, colors, phase, speed, baseB, linePositions } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const ph = new Float32Array(count);
    const sp = new Float32Array(count);
    const bb = new Float32Array(count);
    const pts: number[][] = [];
    for (let i = 0; i < count; i++) {
      // dense spherical shell with thickness + slight interior scatter
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 0.55 + Math.pow(Math.random(), 0.6) * 0.95; // bias outward → shell
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta) * 0.95;
      const z = r * Math.cos(phi);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.8 + Math.random() * 2.0;
      bb[i] = 0.45 + Math.random() * 0.55;
      col[i * 3] = GOLD[0]; col[i * 3 + 1] = GOLD[1]; col[i * 3 + 2] = GOLD[2];
      pts.push([x, y, z]);
    }
    // flowing synapse filaments between nearby points
    const lineCount = lowPerf ? 280 : 720;
    const lines: number[] = [];
    for (let i = 0; i < lineCount; i++) {
      const a = pts[(Math.random() * pts.length) | 0];
      let b: number[] | null = null;
      let best = Infinity;
      for (let k = 0; k < 6; k++) {
        const c = pts[(Math.random() * pts.length) | 0];
        const d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
        if (d > 0.02 && d < best) { best = d; b = c; }
      }
      if (b) lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return { positions: pos, colors: col, phase: ph, speed: sp, baseB: bb, linePositions: new Float32Array(lines) };
  }, [count, lowPerf]);

  useFrame((s, dt) => {
    const v = vis.current;
    const t = s.clock.elapsedTime;
    // "activity" — how hard DAWN is working (idle ~0.2, thinking/responding ~1)
    const active = THREE.MathUtils.clamp((v.core - 0.7) / 0.7, 0, 1);

    if (group.current) {
      group.current.rotation.y += dt * (0.05 + active * 0.22);
      group.current.rotation.x = Math.sin(t * 0.1) * 0.18;
      group.current.rotation.z = Math.cos(t * 0.07) * 0.1;
      group.current.scale.setScalar((1 + Math.sin(t * v.pulse) * 0.06) * (1 + growth * 0.08));
    }

    // spawn firings — rate scales hard with activity
    const arr = fires.current;
    const rate = 1.5 + active * 60;
    for (let k = 0; k < 3; k++) if (Math.random() < rate * dt) arr.push({ i: (Math.random() * count) | 0, t0: t });

    // recompute per-point colour: base twinkle + neuron firings
    const col = colors;
    for (let i = 0; i < count; i++) {
      const b = baseB[i] * (0.5 + 0.5 * Math.sin(t * speed[i] + phase[i]));
      col[i * 3] = GOLD[0] * b; col[i * 3 + 1] = GOLD[1] * b; col[i * 3 + 2] = GOLD[2] * b;
    }
    const LIFE = 0.55;
    let alive = 0;
    for (let f = 0; f < arr.length; f++) {
      const age = t - arr[f].t0;
      if (age > LIFE) continue;
      arr[alive++] = arr[f];
      const k = 1 - age / LIFE;
      const i = arr[f].i;
      col[i * 3] = Math.min(2.2, col[i * 3] + k * 4.2);
      col[i * 3 + 1] = Math.min(2.0, col[i * 3 + 1] + k * 3.4);
      col[i * 3 + 2] = Math.min(1.6, col[i * 3 + 2] + k * 1.8);
    }
    arr.length = alive;
    if (ptsGeo.current) (ptsGeo.current.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    if (ptsMat.current) ptsMat.current.size = (lowPerf ? 0.05 : 0.038) * (1 + active * 0.5) * (1 + growth * 0.1);
    if (lineMat.current) {
      lineMat.current.color.copy(v.accent);
      lineMat.current.opacity = (0.07 + 0.16 * active) * (0.55 + 0.45 * Math.abs(Math.sin(t * 1.6))) * v.opacity;
    }
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry ref={ptsGeo}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={ptsMat} size={0.038} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation toneMapped={false} />
      </points>
      {linePositions.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={lineMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
      )}
    </group>
  );
}
