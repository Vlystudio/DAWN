import type { BrainStateName } from '../types';

/**
 * BrainState — DAWN's brain state machine definition + per-state visuals.
 * The single source of truth for how the brain looks/behaves in every state.
 */

export interface BrainVisual {
  color: string;
  accent: string;
  glow: number; // 0..1 bloom-ish glow
  core: number; // emissive intensity
  pulse: number; // breathing speed
  ring: number; // orbit ring speed
  spin: number;
  particleMode: 'assemble' | 'idle' | 'pulse' | 'inward' | 'outward' | 'build' | 'scatter' | 'listen';
  radar: boolean;
  flicker: number;
  opacity: number;
  activeCluster: string | null; // which brain region lights up
}

export const COLORS: Record<string, string> = {
  // Gold/amber JARVIS signature — warm energy core, accents shift with activity.
  gold: '#ffb020',
  goldHot: '#ffd27a',
  orange: '#ff7a18',
  amber: '#f59e0b',
  cyan: '#38bdf8',
  teal: '#2dd4bf',
  violet: '#a855f7',
  green: '#34d399',
  blue: '#60a5fa',
  red: '#ef4444',
  dim: '#4a3b22',
};

export const STATE_META: Record<BrainStateName, { label: string; hint: string }> = {
  OFF: { label: 'Dormant', hint: 'DAWN is offline.' },
  BOOTING: { label: 'Booting', hint: 'Assembling the neural core…' },
  IDLE: { label: 'Ready', hint: 'Listening for you.' },
  LISTENING: { label: 'Listening', hint: 'Taking in your message…' },
  THINKING: { label: 'Thinking', hint: 'Reasoning about your request…' },
  RETRIEVING_MEMORY: { label: 'Recalling', hint: 'Pulling from memory…' },
  READING_LOCAL_FILES: { label: 'Reading files', hint: 'Reading your local knowledge…' },
  SEARCHING_WEB: { label: 'Searching', hint: 'Searching the web…' },
  SYNTHESIZING: { label: 'Synthesizing', hint: 'Weighing sources and reasoning…' },
  CITING_SOURCES: { label: 'Citing', hint: 'Attaching citations and sources…' },
  INDEXING: { label: 'Indexing', hint: 'Building the knowledge graph…' },
  RESPONDING: { label: 'Responding', hint: 'Composing the answer…' },
  LOOKING: { label: 'Looking', hint: 'Watching the live camera…' },
  ERROR: { label: 'Attention', hint: 'Something needs a look.' },
};

export const VISUALS: Record<BrainStateName, BrainVisual> = {
  OFF:                 { color: COLORS.dim,     accent: '#2a2110', glow: 0.05, core: 0.12, pulse: 0.4, ring: 0.04, spin: 0.04, particleMode: 'scatter', radar: false, flicker: 0,    opacity: 0.4,  activeCluster: null },
  BOOTING:             { color: COLORS.gold,    accent: COLORS.orange,  glow: 0.7,  core: 1.0,  pulse: 1.7, ring: 1.4, spin: 0.7,  particleMode: 'assemble', radar: false, flicker: 0,    opacity: 0.95, activeCluster: null },
  IDLE:                { color: COLORS.gold,    accent: COLORS.orange,  glow: 0.5,  core: 0.85, pulse: 0.85,ring: 0.5, spin: 0.2,  particleMode: 'idle',     radar: false, flicker: 0,    opacity: 1,    activeCluster: null },
  LISTENING:           { color: COLORS.goldHot, accent: COLORS.gold,    glow: 0.6,  core: 0.95, pulse: 1.2, ring: 0.7, spin: 0.3,  particleMode: 'listen',   radar: false, flicker: 0,    opacity: 1,    activeCluster: null },
  THINKING:            { color: COLORS.orange,  accent: COLORS.goldHot, glow: 0.85, core: 1.3,  pulse: 1.9, ring: 1.9, spin: 0.9,  particleMode: 'pulse',    radar: false, flicker: 0,    opacity: 1,    activeCluster: null },
  RETRIEVING_MEMORY:   { color: COLORS.gold,    accent: COLORS.violet,  glow: 0.75, core: 1.1,  pulse: 1.5, ring: 1.2, spin: 0.5,  particleMode: 'inward',   radar: false, flicker: 0,    opacity: 1,    activeCluster: 'memories' },
  READING_LOCAL_FILES: { color: COLORS.gold,    accent: COLORS.teal,    glow: 0.72, core: 1.05, pulse: 1.3, ring: 1.0, spin: 0.4,  particleMode: 'inward',   radar: false, flicker: 0,    opacity: 1,    activeCluster: 'knowledge' },
  SEARCHING_WEB:       { color: COLORS.goldHot, accent: COLORS.cyan,    glow: 0.78, core: 1.05, pulse: 1.4, ring: 1.4, spin: 0.5,  particleMode: 'outward',  radar: true,  flicker: 0,    opacity: 1,    activeCluster: 'web' },
  SYNTHESIZING:        { color: COLORS.gold,    accent: COLORS.violet,  glow: 0.86, core: 1.3,  pulse: 1.8, ring: 1.5, spin: 0.7,  particleMode: 'inward',   radar: false, flicker: 0,    opacity: 1,    activeCluster: 'web' },
  CITING_SOURCES:      { color: COLORS.goldHot, accent: COLORS.teal,    glow: 0.8,  core: 1.15, pulse: 1.5, ring: 1.3, spin: 0.5,  particleMode: 'pulse',    radar: false, flicker: 0,    opacity: 1,    activeCluster: 'web' },
  INDEXING:            { color: COLORS.amber,   accent: COLORS.orange,  glow: 0.7,  core: 1.05, pulse: 1.2, ring: 1.0, spin: 0.4,  particleMode: 'build',    radar: false, flicker: 0,    opacity: 1,    activeCluster: 'knowledge' },
  RESPONDING:          { color: COLORS.goldHot, accent: COLORS.orange,  glow: 0.9,  core: 1.45, pulse: 2.5, ring: 1.2, spin: 0.5,  particleMode: 'pulse',    radar: false, flicker: 0,    opacity: 1,    activeCluster: null },
  LOOKING:             { color: COLORS.cyan,    accent: COLORS.goldHot, glow: 0.82, core: 1.1,  pulse: 1.5, ring: 1.6, spin: 0.6,  particleMode: 'outward',  radar: true,  flicker: 0,    opacity: 1,    activeCluster: null },
  ERROR:               { color: COLORS.red,     accent: '#b91c1c',      glow: 0.6,  core: 1.0,  pulse: 1.0, ring: 0.3, spin: 0.1,  particleMode: 'scatter',  radar: false, flicker: 0.6,  opacity: 1,    activeCluster: null },
};

/**
 * Warm/golden palette for the Brain Explorer map. Gold-dominant (the big
 * structural regions glow gold) with a few cool accents so regions stay
 * distinguishable. Used by both the 3D field and the sidebar legend so they
 * always match.
 */
export const REGION_COLORS: Record<string, string> = {
  cyan: '#ffc24d',   // conversations / web / core → gold
  amber: '#ff9e2c',  // logic & rules
  orange: '#ff7a18', // obsidian vault
  violet: '#bf8bff', // memories (cool accent)
  teal: '#34e0c0',   // projects (cool accent)
  green: '#57e39a',  // knowledge (cool accent)
  blue: '#7fb0ff',   // tools (cool accent)
  slate: '#aebfd4',  // notion (cool neutral)
  gold: '#ffb020',
};
export function regionColor(group: string): string {
  return REGION_COLORS[group] || REGION_COLORS.gold;
}

export function visualFor(state: BrainStateName): BrainVisual {
  return VISUALS[state] || VISUALS.IDLE;
}
export function metaFor(state: BrainStateName) {
  return STATE_META[state] || STATE_META.IDLE;
}

/** Map the llama.cpp runtime state to a base brain state. */
export function runtimeToBrain(runtimeState: string): BrainStateName {
  switch (runtimeState) {
    case 'STARTING':
    case 'LOADING_MODEL':
      return 'BOOTING';
    case 'READY':
    case 'GENERATING':
      return 'IDLE';
    case 'ERROR':
      return 'ERROR';
    case 'STOPPING':
      return 'BOOTING';
    default:
      return 'OFF';
  }
}

/** Map a chat status line to a brain state (when the main process doesn't specify one). */
export function statusToBrain(status: string): BrainStateName {
  const s = (status || '').toLowerCase();
  if (/look|camera|vision|watch/.test(s)) return 'LOOKING';
  if (/recall|memor/.test(s)) return 'RETRIEVING_MEMORY';
  if (/read|file|local/.test(s)) return 'READING_LOCAL_FILES';
  if (/cit(e|ing)|source/.test(s)) return 'CITING_SOURCES';
  if (/synth|reason|analy/.test(s)) return 'SYNTHESIZING';
  if (/search|web/.test(s)) return 'SEARCHING_WEB';
  if (/index/.test(s)) return 'INDEXING';
  return 'THINKING';
}
