import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Holographic orbit rings + a radar sweep ring (active during web search). */
export default function BrainOrbitRings({ vis }: { vis: any }) {
  const r1 = useRef<any>();
  const r2 = useRef<any>();
  const r3 = useRef<any>();
  const m = [useRef<any>(), useRef<any>(), useRef<any>()];
  const radar = useRef<any>();
  const radarMat = useRef<any>();

  useFrame((s, dt) => {
    const v = vis.current;
    const t = s.clock.elapsedTime;
    const sp = v.ring;
    if (r1.current) r1.current.rotation.z += dt * 0.4 * sp;
    if (r2.current) { r2.current.rotation.x += dt * 0.3 * sp; r2.current.rotation.y += dt * 0.15 * sp; }
    if (r3.current) r3.current.rotation.y += dt * 0.5 * sp;
    for (const ref of m) {
      if (ref.current) { ref.current.color.copy(v.color); ref.current.opacity = 0.5 * v.opacity; }
    }
    if (radar.current && radarMat.current) {
      if (v.radar > 0.5) {
        radar.current.visible = true;
        const p = (t % 2) / 2;
        const scale = 1 + p * 2.2;
        radar.current.scale.set(scale, scale, scale);
        radarMat.current.color.copy(v.color);
        radarMat.current.opacity = (1 - p) * 0.5 * v.opacity;
      } else radar.current.visible = false;
    }
  });

  return (
    <group>
      <mesh ref={r1} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.85, 0.012, 12, 140]} />
        <meshBasicMaterial ref={m[0]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={r2} rotation={[Math.PI / 3, Math.PI / 5, 0]}>
        <torusGeometry args={[2.2, 0.009, 12, 160]} />
        <meshBasicMaterial ref={m[1]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={r3} rotation={[Math.PI / 2.5, 0, Math.PI / 4]}>
        <torusGeometry args={[2.55, 0.006, 12, 160]} />
        <meshBasicMaterial ref={m[2]} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={radar} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[1.4, 0.02, 8, 120]} />
        <meshBasicMaterial ref={radarMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
