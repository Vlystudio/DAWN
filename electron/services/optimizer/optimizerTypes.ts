/**
 * optimizerTypes.ts — shared types for the DAWN Model Optimizer (pure, electron-free).
 */

export type Vendor = 'nvidia' | 'amd' | 'apple' | 'intel' | 'unknown';

export interface GpuInfo {
  name: string;
  vramGB?: number;
  vendor?: Vendor;
  cudaAvailable?: boolean;
  directMLAvailable?: boolean;
  metalAvailable?: boolean;
  rocmAvailable?: boolean;
}

export interface HardwareProfile {
  os: string;                 // 'Windows' | 'macOS' | 'Linux'
  arch?: string;
  cpuName?: string;
  cpuCores?: number;          // physical-ish (logical/2 fallback)
  cpuThreads?: number;        // logical
  totalRamGB?: number;
  availableRamGB?: number;
  gpus: GpuInfo[];
  diskFreeGB?: number;
  modelsDir?: string;
  installedModels?: string[]; // gguf filenames
  backends: {
    ollama?: boolean;
    llamaCpp?: boolean;
    cuda?: boolean;
    directML?: boolean;
    metal?: boolean;
    rocm?: boolean;
    cpuOnly?: boolean;
  };
  detectedAt?: string;
  hash?: string;              // stable signature of the profile (for "hardware changed")
}

export type Category =
  | 'General Assistant' | 'Coding' | 'Reasoning' | 'Research' | 'Summarization'
  | 'Creative Writing' | 'Vision' | 'Embeddings' | 'Memory/RAG' | 'Cybersecurity Assistant'
  | 'Data Analysis' | 'Planning' | 'Lightweight/Fast' | 'Long Context' | 'General Assistant';

export interface ParsedModel {
  raw: string;           // original identifier (filename or ollama tag)
  family: string;        // normalized family key, e.g. 'qwen2.5-coder'
  paramsB: number;       // total parameters in billions (0 if unknown)
  activeB?: number;      // active params for MoE
  isMoE: boolean;
  quant: string;         // e.g. 'Q4_K_M' | 'unknown'
  isEmbedding: boolean;
  isVision: boolean;
}

export interface ModelMetadata {
  friendlyName: string;
  actualName: string;    // backend identifier we matched (filename/tag) — never lost
  family: string;
  category: Category;
  paramsB: number;
  activeB?: number;
  isMoE: boolean;
  quant: string;
  purpose: string;
  bestFor: string[];
  strengths: string[];
  weaknesses: string[];
  tags: string[];
  recommendedContext: number;     // tokens
  recommendedBackend: 'gpu' | 'cpu' | 'either';
  notes?: string;
  // requirement estimates (derived)
  estMinVramGB: number;
  estComfortVramGB: number;
  estRamGB: number;
  known: boolean;                 // false => inferred from the name
}

export type CompatLevel = 'Excellent' | 'Good' | 'Borderline' | 'CPU-only fallback' | 'Not recommended' | 'Unsupported';
export type OptimizerMode = 'Performance' | 'Balanced' | 'Quality' | 'Safe' | 'Low VRAM';

export interface Compatibility {
  level: CompatLevel;
  score: number;          // 0..100
  reason: string;         // plain English
  warnings: string[];
  recommendedMode: OptimizerMode;
  expectedSpeed: 'very fast' | 'fast' | 'moderate' | 'slow' | 'very slow';
  fitsFullyOnGpu: boolean;
  needsCpuOffload: boolean;
  allowOverride: boolean; // can the user force-load anyway?
  estVramUseGB: number;
  estRamUseGB: number;
}

/** A patch DAWN's settings store understands — applied to the real llama.cpp runtime args. */
export interface OptimizedSettings {
  contextLength: number;
  gpuLayers: number;          // -ngl  (999 = all)
  threads: number;            // -t
  batchSize: number;          // -b
  ubatchSize: number;         // -ub  (physical batch; 0 = default)
  mmap: boolean;              // memory-map weights (false => --no-mmap)
  mlock: boolean;             // lock weights in RAM (--mlock)
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  lowVram: boolean;
  performanceMode: 'balanced' | 'high' | 'lowvram' | 'cpu';
  parallelRequests: number;   // advisory (DAWN serializes; surfaced as guidance)
}

export interface OptimizationResult {
  mode: OptimizerMode;
  settings: OptimizedSettings;
  explanation: string;        // human-readable "why + what changed"
  changed: string[];          // bullet lines of applied settings
  tradeoffs: string[];
  unsupported: string[];      // recommended-but-unsupported-by-backend notes
}

export interface ModelAnalysis {
  actualName: string;
  path?: string;              // gguf path if installed
  parsed: ParsedModel;
  metadata: ModelMetadata;
  compatibility: Compatibility;
  optimization: OptimizationResult;   // for the recommended mode
  installed: boolean;
}
