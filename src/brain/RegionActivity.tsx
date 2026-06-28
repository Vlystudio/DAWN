import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBrainStore } from '../state/brainStore';
import { regionPoint } from './brainShape';
import { regionColor } from './BrainState';

/**
 * RegionActivity — lights up the anatomically-correct lobe for whatever DAWN is
 * doing right now, with bright "neuron" pulses streaming from the core into that
 * region. Recall → hippocampus, reading the vault → temporal lobe, reasoning →
 * prefrontal, web → occipital, responding → language cortex. Driven entirely by
 * the live brain state (+ the status text, so Obsidian vs Notion vs files each
 * light their own area). Calm when idle.
 */

const REGION_GROUP: Record<string, string> = {
  conversations: 'cyan', memories: 'violet', projects: 'teal', vault: 'orange',
  logic: 'amber', tools: 'blue', knowledge: 'green', web: 'cyan', notion: 'slate', core: 'gold',
};
const STATE_REGION: Record<string, string | null> = {
  THINKING: 'logic', RESPONDING: 'conversations', LISTENING: 'conversations',
  RETRIEVING_MEMORY: 'memories', SEARCHING_WEB: 'web', INDEXING: 'knowledge', BOOTING: 'core',
  READING_LOCAL_FILES: 'knowledge', IDLE: null, OFF: null, ERROR: null,
};

let glowTex: THREE.CanvasTexture | null = null;
function getGlow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const CENTER: [number, number, number] = [0, 0.3, 0];

export default function RegionActivity({ faint = false }: { faint?: boolean }) {
  const state = useBrainStore((s) => s.mock ?? s.state);
  const message = useBrainStore((s) => s.message);

  let region = STATE_REGION[state] ?? null;
  if (state === 'READING_LOCAL_FILES') {
    const m = (message || '').toLowerCase();
    region = m.includes('notion') ? 'notion' : (m.includes('obsidian') || m.includes('vault')) ? 'vault' : 'knowledge';
  }

  const geo = useRef<THREE.BufferGeometry>(null);
  const mat = useRef<any>();
  const glowRef = useRef<any>();
  const glowMat = useRef<any>();
  const intensity = useRef(0);

  const PER = faint ? 5 : 9;
  const { targets, color, centroid } = useMemo(() => {
    const reg = region || 'core';
    const tg: [number, number, number][] = [];
    const cen = [0, 0, 0];
    for (let i = 0; i < 14; i++) {
      const p = regionPoint(reg, `act-${reg}-${i}`);
      tg.push(p); cen[0] += p[0]; cen[1] += p[1]; cen[2] += p[2];
    }
    cen[0] /= tg.length; cen[1] /= tg.length; cen[2] /= tg.length;
    return { targets: tg, color: new THREE.Color(regionColor(REGION_GROUP[reg] || 'gold')), centroid: cen as [number, number, number] };
  }, [region]);

  const count = targets.length * PER;
  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const colors = useMemo(() => new Float32Array(count * 3), [count]);
  const phases = useMemo(() => { const a = new Float32Array(count); for (let i = 0; i < count; i++) a[i] = Math.random(); return a; }, [count]);

  useFrame((s, dt) => {
    const want = region ? 1 : 0;
    intensity.current += (want - intensity.current) * Math.min(1, dt * 2.5);
    const I = intensity.current;
    const t = s.clock.elapsedTime;
    const pos = positions; const col = colors;
    for (let ti = 0; ti < targets.length; ti++) {
      const tg = targets[ti];
      for (let n = 0; n < PER; n++) {
        const idx = ti * PER + n;
        const ph = (phases[idx] + t * 0.7) % 1;
        pos[idx * 3] = CENTER[0] + (tg[0] - CENTER[0]) * ph;
        pos[idx * 3 + 1] = CENTER[1] + (tg[1] - CENTER[1]) * ph;
        pos[idx * 3 + 2] = CENTER[2] + (tg[2] - CENTER[2]) * ph;
        const b = Math.sin(ph * Math.PI) * I * (faint ? 0.55 : 1);
        col[idx * 3] = color.r * b * 1.6; col[idx * 3 + 1] = color.g * b * 1.6; col[idx * 3 + 2] = color.b * b * 1.6;
      }
    }
    if (geo.current) {
      (geo.current.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geo.current.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    if (mat.current) mat.current.size = (faint ? 0.05 : 0.085) * (0.6 + 0.6 * I);
    if (glowRef.current) {
      glowRef.current.position.set(centroid[0], centroid[1], centroid[2]);
      const sc = (faint ? 1.6 : 2.4) * (0.8 + 0.4 * Math.sin(t * 3));
      glowRef.current.scale.set(sc, sc, sc);
    }
    if (glowMat.current) { glowMat.current.color.copy(color); glowMat.current.opacity = (faint ? 0.18 : 0.32) * I; }
  });

  return (
    <group>
      <points>
        <bufferGeometry ref={geo}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial ref={mat} size={0.085} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation toneMapped={false} />
      </points>
      <sprite ref={glowRef}>
        <spriteMaterial ref={glowMat} map={getGlow()} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}
