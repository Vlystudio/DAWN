import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { GraphNode, GraphEdge } from '../types';

/** NeuralConnections — long-range axon highways between data neurons (brain
 *  positions), drawn as faint golden additive lines. */
export default function NeuralConnections({
  nodes,
  edges,
  positions,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: Map<string, [number, number, number]>;
}) {
  const linePositions = useMemo(() => {
    const at = (id: string): [number, number, number] | null => {
      const p = positions.get(id);
      if (p) return p;
      const n = nodes.find((x) => x.id === id);
      return n ? [n.position_x, n.position_y, n.position_z] : null;
    };
    const arr: number[] = [];
    for (const e of edges) {
      const a = at(e.source_node_id);
      const b = at(e.target_node_id);
      if (a && b) arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    return new Float32Array(arr);
  }, [nodes, edges, positions]);

  if (!linePositions.length) return null;

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffae3a" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </lineSegments>
  );
}
