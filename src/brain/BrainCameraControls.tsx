import React from 'react';
import { OrbitControls } from '@react-three/drei';

/** Orbit / zoom / pan controls for the Brain Explorer. Auto-rotates gently when
 *  nothing is selected so the brain feels alive. */
export default function BrainCameraControls({ autoRotate }: { autoRotate: boolean }) {
  return (
    <OrbitControls
      enableDamping
      dampingFactor={0.1}
      autoRotate={autoRotate}
      autoRotateSpeed={0.5}
      minDistance={3}
      maxDistance={22}
      makeDefault
    />
  );
}
