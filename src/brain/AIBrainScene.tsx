import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { useBrainStore } from '../state/brainStore';
import { visualFor, metaFor } from './BrainState';
import AIBrainCore from './AIBrainCore';
import BrainParticles from './BrainParticles';

let _webgl: boolean | null = null;
function hasWebGL() {
  if (_webgl !== null) return _webgl;
  try {
    const c = document.createElement('canvas');
    _webgl = !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    _webgl = false;
  }
  return _webgl;
}

function mkVis(v: any) {
  const t = { glow: v.glow, core: v.core, pulse: v.pulse, ring: v.ring, spin: v.spin, opacity: v.opacity, flicker: v.flicker, radar: v.radar ? 1 : 0 };
  return {
    color: new THREE.Color(v.color), accent: new THREE.Color(v.accent),
    targetColor: new THREE.Color(v.color), targetAccent: new THREE.Color(v.accent),
    ...t, mode: v.particleMode, modeStart: performance.now() / 1000, target: { ...t },
  };
}

function FpsCap({ fps }: { fps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!fps) return undefined;
    const id = setInterval(() => invalidate(), 1000 / fps);
    return () => clearInterval(id);
  }, [fps, invalidate]);
  return null;
}

function Scene({ lowPerf, particles }: { lowPerf: boolean; particles: boolean }) {
  const stateName = useBrainStore((s) => s.mock ?? s.state);
  const growth = useBrainStore((s) => s.growth);
  const vis = useRef<any>(null);
  if (!vis.current) vis.current = mkVis(visualFor(stateName));

  useEffect(() => {
    const v = visualFor(stateName);
    const c = vis.current;
    c.targetColor.set(v.color);
    c.targetAccent.set(v.accent);
    c.target = { glow: v.glow, core: v.core, pulse: v.pulse, ring: v.ring, spin: v.spin, opacity: v.opacity, flicker: v.flicker, radar: v.radar ? 1 : 0 };
    c.mode = v.particleMode;
    c.modeStart = performance.now() / 1000;
  }, [stateName]);

  const root = useRef<any>();
  const light = useRef<any>();
  useFrame((s, dt) => {
    const c = vis.current;
    const k = Math.min(1, dt * 3.5);
    c.color.lerp(c.targetColor, k);
    c.accent.lerp(c.targetAccent, k);
    for (const key of ['glow', 'core', 'pulse', 'ring', 'spin', 'opacity', 'flicker', 'radar'] as const) {
      c[key] += (c.target[key] - c[key]) * k;
    }
    if (root.current) {
      const t = s.clock.elapsedTime;
      root.current.position.y = Math.sin(t * 0.6) * 0.06;
      root.current.rotation.y = Math.sin(t * 0.15) * 0.08;
    }
    if (light.current) {
      light.current.color.copy(c.color);
      light.current.intensity = 1.2 + c.core * 1.6;
    }
  });

  return (
    <group ref={root}>
      <ambientLight intensity={0.4} />
      <pointLight ref={light} position={[0, 0, 0]} distance={10} intensity={2} />
      <pointLight position={[4, 4, 4]} intensity={0.4} color="#ffffff" />
      <AIBrainCore vis={vis} growth={growth} />
      {particles && <BrainParticles vis={vis} lowPerf={lowPerf} growth={growth} />}
    </group>
  );
}

function Fallback({ color, accent }: { color: string; accent: string }) {
  return (
    <div className="w-full h-full grid place-items-center relative" style={{ ['--c' as any]: color, ['--a' as any]: accent }}>
      <div className="absolute rounded-full animate-[spin_9s_linear_infinite]" style={{ width: '54%', height: '54%', border: `1px dashed ${color}`, opacity: 0.5 }} />
      <div className="absolute rounded-full animate-[spin_16s_linear_infinite_reverse]" style={{ width: '76%', height: '76%', border: `1px solid ${accent}`, opacity: 0.35 }} />
      <div className="rounded-full animate-pulseSoft" style={{ width: '34%', height: '34%', background: `radial-gradient(circle, ${color}, transparent 72%)`, boxShadow: `0 0 40px ${color}` }} />
    </div>
  );
}

export default function AIBrainScene({ size = 'lg', onClick }: { size?: 'lg' | 'sm'; onClick?: () => void }) {
  const perf = useBrainStore((s) => s.perf);
  const stateName = useBrainStore((s) => s.mock ?? s.state);
  const message = useBrainStore((s) => s.message);
  const v = visualFor(stateName);
  const meta = metaFor(stateName);
  const [hover, setHover] = useState(false);
  const use3D = perf.brain3DEnabled && hasWebGL();
  // Lightweight for the small docked brain; FPS cap so it never pegs the GPU.
  const lowP = perf.lowPerfMode || size === 'sm';
  const cap = perf.fpsCap || (perf.lowPerfMode ? 20 : size === 'sm' ? 30 : 40);
  const dim = size === 'lg' ? 'min(440px,56vh)' : '56px';

  return (
    <div
      className={`relative flex flex-col items-center ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={onClick ? 'Open Brain Explorer' : undefined}
    >
      <div
        className="absolute rounded-full pointer-events-none"
        style={{ inset: '-8%', filter: size === 'lg' ? 'blur(34px)' : 'blur(12px)', background: `radial-gradient(circle at 50% 45%, ${v.color}55, transparent 60%)`, opacity: 0.4 + v.glow * 0.6 }}
      />
      <div className="relative" style={{ width: dim, height: dim }}>
        {use3D ? (
          <Canvas
            key={`${use3D}-${perf.lowPerfMode}-${size}`}
            camera={{ position: [0, 0, 6], fov: 45 }}
            dpr={lowP ? 1 : [1, 1.5]}
            gl={{ antialias: !lowP, alpha: true, powerPreference: 'high-performance' }}
            frameloop="demand"
            style={{ background: 'transparent' }}
          >
            {/* Cap the render loop so the always-visible brain doesn't peg the GPU. */}
            <FpsCap fps={cap} />
            <Scene lowPerf={lowP} particles={perf.brainParticles} />
          </Canvas>
        ) : (
          <Fallback color={v.color} accent={v.accent} />
        )}
      </div>

      {/* Overlay label */}
      <div className={size === 'sm' ? 'absolute top-full right-0 mt-2 z-50' : 'text-center -mt-1'}>
        <AnimatePresence mode="wait">
          {(size === 'lg' || hover) && (
            <motion.div
              key={stateName + message}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className={size === 'sm' ? 'glass px-3 py-2 text-left whitespace-nowrap' : ''}
            >
              <div className="text-sm font-bold inline-flex items-center gap-2" style={{ color: v.color }}>
                <span className="w-2 h-2 rounded-full" style={{ background: v.color, boxShadow: `0 0 12px ${v.color}` }} />
                {meta.label}
              </div>
              <div className="text-dim text-xs mt-1 max-w-[240px] whitespace-normal">{message || meta.hint}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
