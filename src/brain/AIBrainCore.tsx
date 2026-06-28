import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * AIBrainCore — the soft, organic energy heart of the hero brain: a hot bright
 * nucleus and layered additive halos that breathe and flare brighter as DAWN
 * works. No rigid wireframe — the living swarm (BrainParticles) is the body.
 */
const WHITE = new THREE.Color('#fff4d6');

export default function AIBrainCore({ vis, growth = 0 }: { vis: any; growth?: number }) {
  const hot = useRef<any>();
  const hotMat = useRef<any>();
  const halo = useRef<any>();
  const haloMat = useRef<any>();
  const halo2 = useRef<any>();
  const halo2Mat = useRef<any>();

  useFrame((s) => {
    const v = vis.current;
    const t = s.clock.elapsedTime;
    const breathe = 1 + Math.sin(t * v.pulse) * 0.07;
    const active = THREE.MathUtils.clamp((v.core - 0.7) / 0.7, 0, 1);
    let flick = 1;
    if (v.flicker > 0.01) flick = (0.55 + 0.45 * Math.abs(Math.sin(t * 22))) * (Math.random() > 0.9 ? 0.4 : 1);
    // a soft inner pulse that quickens with activity
    const pulse = 0.85 + 0.15 * Math.sin(t * (2 + active * 6));

    if (hot.current) {
      hot.current.scale.setScalar(0.5 * breathe * (1 + active * 0.18));
      hot.current.rotation.y += 0.004;
    }
    if (hotMat.current) {
      hotMat.current.color.copy(v.color).lerp(WHITE, 0.5 + active * 0.35);
      hotMat.current.opacity = (0.78 + 0.22 * active) * pulse * v.opacity * flick;
    }
    if (halo.current) halo.current.scale.setScalar(1.45 * breathe * (1 + growth * 0.06));
    if (haloMat.current) {
      haloMat.current.color.copy(v.color);
      haloMat.current.opacity = 0.13 * v.glow * 2 * v.opacity * flick * pulse;
    }
    if (halo2.current) halo2.current.scale.setScalar(2.5 * breathe);
    if (halo2Mat.current) {
      halo2Mat.current.color.copy(v.accent);
      halo2Mat.current.opacity = 0.05 * v.glow * v.opacity;
    }
  });

  return (
    <group>
      <mesh ref={hot}>
        <sphereGeometry args={[1, 28, 28]} />
        <meshBasicMaterial ref={hotMat} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial ref={haloMat} transparent side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={halo2}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshBasicMaterial ref={halo2Mat} transparent side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
