import { create } from 'zustand';

export interface RuntimeStatus {
  state: 'OFF' | 'STARTING' | 'LOADING_MODEL' | 'READY' | 'GENERATING' | 'ERROR' | 'STOPPING';
  port: number;
  backend: string;
  model: string;
  error: string | null;
  installed: boolean;
  hasModel: boolean;
}

interface RS {
  status: RuntimeStatus;
  setStatus: (s: RuntimeStatus) => void;
  refresh: () => Promise<void>;
}

/** Mirrors the DawnRuntimeManager state in the renderer (updated via events). */
export const useRuntimeStore = create<RS>((set) => ({
  status: { state: 'OFF', port: 0, backend: 'Unknown', model: '', error: null, installed: false, hasModel: false },
  setStatus: (status) => set({ status }),
  refresh: async () => set({ status: await window.dawn.runtime.status() }),
}));
