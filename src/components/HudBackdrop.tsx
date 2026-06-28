import React, { useEffect } from 'react';
import { useBrainStore } from '../state/brainStore';
import { visualFor } from '../brain/BrainState';

/**
 * HudBackdrop — the ambient holographic layer behind the whole app, plus the
 * single source of the live `--accent` CSS variable. The accent (and therefore
 * every glow, hairline, and readout in the HUD) shifts colour with DAWN's real
 * state: cyan idle, violet thinking, green reading files, amber indexing, red
 * error. Purposeful, not decorative.
 */

function hexToRgb(hex: string): string {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const int = parseInt(n, 16);
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}

export default function HudBackdrop() {
  const current = useBrainStore((s) => s.mock ?? s.state);

  useEffect(() => {
    const v = visualFor(current);
    const root = document.documentElement.style;
    root.setProperty('--accent', v.color);
    root.setProperty('--accent-rgb', hexToRgb(v.color));
    root.setProperty('--accent-2', v.accent || v.color);
  }, [current]);

  return (
    <div className="hud-backdrop" aria-hidden>
      <div className="hud-grid" />
      <div className="hud-glow" />
      <div className="hud-scan animate-scanline" style={{ top: 0 }} />
      <div className="hud-vignette" />
    </div>
  );
}
