import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { GraphNode } from '../types';
import { regionColor } from './BrainState';
import { growFibers, type Soma } from './fibers';
import { mulberry32, hash } from './brainShape';

/**
 * NeuralNodeField — the DATA neurons (conversations, memories, Obsidian…) as
 * REAL neurons: a small, soft soma (no hard blob) sprouting a large, bright,
 * branching dendritic arbor in its region colour. The arbor is the neuron — you
 * read it by its fibers, like a connectome reconstruction. Somas stay clickable.
 */

// Soft soma sprite: a bright tight nucleus fading into a soft glow (a cell body,
// not a hard disc). White so the per-instance colour tints it.
let somaTex: THREE.CanvasTexture | null = null;
function getSomaTexture() {
  if (somaTex) return somaTex;
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  somaTex = new THREE.CanvasTexture(c);
  return somaTex;
}

export default function NeuralNodeField({
  nodes,
  positions,
  selectedId,
  onSelect,
  visibleTypes,
  highlightIds,
  growth,
  onHover,
}: {
  nodes: GraphNode[];
  positions: Map<string, [number, number, number]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  visibleTypes: Set<string>;
  highlightIds?: Set<string>;
  growth: number;
  onHover?: (node: GraphNode | null, x: number, y: number) => void;
}) {
  const somaRef = useRef<THREE.InstancedMesh>(null);
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const visible = useMemo(
    () =>
      visibleTypes.size === 0
        ? nodes
        : nodes.filter((n) => n.type === 'system_event' || n.type === 'cluster' || visibleTypes.has(n.type)),
    [nodes, visibleTypes]
  );

  const pos = (n: GraphNode): [number, number, number] =>
    positions.get(n.id) || [n.position_x, n.position_y, n.position_z];

  const meta = useMemo(
    () =>
      visible.map((n) => ({
        // small SOFT somas (sprite scale)
        base: n.id === 'core' ? 0.16 : n.type === 'cluster' ? 0.11 : 0.06 + (n.importance || 0.5) * 0.05,
        phase: Math.random() * Math.PI * 2,
        speed: 0.8 + Math.random() * 0.9,
        color: new THREE.Color(n.id === 'core' ? '#ffe6b0' : regionColor(n.color_group)).multiplyScalar(1.3),
      })),
    [visible]
  );

  // Big, bright dendritic arbors — the actual "neuron" shape.
  const dendrites = useMemo(() => {
    const somas: Soma[] = visible
      .filter((n) => n.type !== 'cluster' && n.id !== 'core')
      .map((n) => {
        const c = new THREE.Color(regionColor(n.color_group));
        return { p: pos(n), color: [c.r, c.g, c.b] as [number, number, number], reach: 1.4 + (n.importance || 0.5) * 1.2 };
      });
    if (!somas.length) return { positions: new Float32Array(), colors: new Float32Array() };
    return growFibers(
      somas,
      { primaries: 5 + Math.round(growth * 2), steps: 8, depth: 3 + Math.round(growth), branchProb: 0.42, jitter: 0.82, gravity: 0.03 },
      mulberry32(hash('data') ^ visible.length)
    );
  }, [visible, positions, growth]);

  useLayoutEffect(() => {
    const soma = somaRef.current;
    if (!soma) return;
    visible.forEach((n, i) => {
      const hot = n.id === selectedId || highlightIds?.has(n.id);
      const c = meta[i].color.clone();
      if (hot) c.lerp(new THREE.Color('#ffffff'), 0.6);
      soma.setColorAt(i, c);
    });
    soma.count = visible.length;
    if (hitRef.current) hitRef.current.count = visible.length;
    if (soma.instanceColor) soma.instanceColor.needsUpdate = true;
  }, [visible, selectedId, highlightIds, meta]);

  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const soma = somaRef.current;
    const hit = hitRef.current;
    if (!soma) return;
    visible.forEach((n, i) => {
      const m = meta[i];
      const hot = n.id === selectedId || highlightIds?.has(n.id);
      const breathe = 1 + Math.sin(t * m.speed + m.phase) * 0.2;
      const sc = m.base * (hot ? 2 : 1) * breathe;
      const p = pos(n);
      // soft billboarded soma sprite
      dummy.position.set(p[0], p[1], p[2]);
      dummy.quaternion.copy(s.camera.quaternion);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      soma.setMatrixAt(i, dummy.matrix);
      if (hit) {
        dummy.quaternion.set(0, 0, 0, 1);
        dummy.scale.setScalar(Math.max(0.14, sc));
        dummy.updateMatrix();
        hit.setMatrixAt(i, dummy.matrix);
      }
    });
    soma.instanceMatrix.needsUpdate = true;
    if (hit) hit.instanceMatrix.needsUpdate = true;
  });

  if (!visible.length) return null;

  return (
    <group>
      {/* the neurons' dendritic arbors */}
      {dendrites.positions.length > 0 && (
        <lineSegments raycast={(() => null) as any}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[dendrites.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[dendrites.colors, 3]} />
          </bufferGeometry>
          <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </lineSegments>
      )}

      {/* soft somas (billboarded glow sprites) */}
      <instancedMesh ref={somaRef} args={[undefined as any, undefined as any, visible.length]} raycast={(() => null) as any}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={getSomaTexture()} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>

      {/* invisible, larger click/hover targets */}
      <instancedMesh
        ref={hitRef}
        args={[undefined as any, undefined as any, visible.length]}
        onClick={(e: any) => { e.stopPropagation(); if (e.instanceId != null && visible[e.instanceId]) onSelect(visible[e.instanceId].id); }}
        onPointerMove={(e: any) => { e.stopPropagation(); if (e.instanceId != null && visible[e.instanceId]) onHover?.(visible[e.instanceId], e.nativeEvent.clientX, e.nativeEvent.clientY); }}
        onPointerOut={(e: any) => { e.stopPropagation(); onHover?.(null, 0, 0); }}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
