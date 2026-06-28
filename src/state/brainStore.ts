import { create } from 'zustand';
import type { BrainStateName, Graph } from '../types';

/**
 * Global app store (zustand). Holds the live brain state, the brain graph, and
 * performance settings. Components subscribe with selectors so the 3D brain and
 * the chat UI stay in sync with real activity.
 */

export interface PerfSettings {
  brain3DEnabled: boolean;
  lowPerfMode: boolean;
  brainParticles: boolean;
  fpsCap: number;
  nodeLimit: number;
}

interface BrainStore {
  // Live brain state
  state: BrainStateName;
  message: string;
  progress: number | null;
  mock: BrainStateName | null;
  setBrain: (state: BrainStateName, message?: string, progress?: number | null) => void;
  setMock: (state: BrainStateName | null) => void;
  current: () => BrainStateName;

  // Brain graph data
  graph: Graph | null;
  nodeCount: number;
  growth: number; // 0..1 — how "grown" the brain is, from real knowledge volume
  loadGraph: () => Promise<void>;

  // Perf
  perf: PerfSettings;
  loadPerf: () => Promise<void>;
  setPerf: (patch: Partial<PerfSettings>) => Promise<void>;
}

export const useBrainStore = create<BrainStore>((set, get) => ({
  state: 'OFF',
  message: 'DAWN is offline.',
  progress: null,
  mock: null,
  setBrain: (state, message, progress = null) =>
    set({ state, message: message ?? get().message, progress }),
  setMock: (mock) => set({ mock }),
  current: () => get().mock ?? get().state,

  graph: null,
  nodeCount: 0,
  growth: 0,
  loadGraph: async () => {
    const graph = await window.dawn.graph.get();
    // "Growth" = how much DAWN actually knows. The base scaffold (core + cluster
    // anchors + rules + tools) is ~25 nodes; everything past that — conversations,
    // memories, Obsidian notes, indexed files — grows the brain.
    const n = graph?.nodes?.length || 0;
    const growth = Math.max(0, Math.min(1, (n - 25) / 320));
    set({ graph, nodeCount: n, growth });
  },

  perf: { brain3DEnabled: true, lowPerfMode: false, brainParticles: true, fpsCap: 0, nodeLimit: 1500 },
  loadPerf: async () => {
    const s = await window.dawn.settings.get();
    set({
      perf: {
        brain3DEnabled: s.brain3DEnabled !== false,
        lowPerfMode: !!s.lowPerfMode,
        brainParticles: s.brainParticles !== false,
        fpsCap: s.fpsCap || 0,
        nodeLimit: s.nodeLimit || 1500,
      },
    });
  },
  setPerf: async (patch) => {
    set({ perf: { ...get().perf, ...patch } });
    await window.dawn.settings.save(patch);
  },
}));
