import React, { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import BrainConnectome from './BrainConnectome';
import RegionActivity from './RegionActivity';
import { useBrainStore } from '../state/brainStore';

function FpsCap({ fps = 30 }: { fps?: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / fps);
    return () => clearInterval(id);
  }, [fps, invalidate]);
  return null;
}

/**
 * BrainBackdrop — the same anatomical connectome from the Brain page, rendered
 * faint and slowly turning behind the chat. Its lobes fire (via RegionActivity)
 * with what DAWN is doing, so the chat literally happens "inside the brain".
 * Non-interactive, dimmed, capped DPR. The Brain page stays the bright master.
 */

function Slow({ children }: { children: React.ReactNode }) {
  const g = useRef<any>();
  useFrame((_s, dt) => { if (g.current) g.current.rotation.y += dt * 0.04; });
  return <group ref={g}>{children}</group>;
}

export default function BrainBackdrop() {
  const growth = useBrainStore((s) => s.growth);
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0, opacity: 0.32 }} aria-hidden>
      <Canvas
        camera={{ position: [0, 0.3, 9.6], fov: 50 }}
        dpr={[1, 1.4]}
        gl={{ alpha: true, antialias: false, powerPreference: 'high-performance' }}
        frameloop="demand"
        style={{ background: 'transparent' }}
      >
        <FpsCap fps={30} />
        <ambientLight intensity={0.4} />
        <pointLight position={[0, 0.3, 0]} intensity={1.2} color="#ffb020" />
        <Slow>
          <BrainConnectome growth={growth} />
        </Slow>
        <RegionActivity faint />
      </Canvas>
    </div>
  );
}
