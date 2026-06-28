/**
 * catalog.ts — DAWN Model Hub catalog of free / open-weight GGUF models.
 *
 * Every URL here was VERIFIED (HTTP 206 via Range GET) to be publicly
 * downloadable without login — mostly the excellent bartowski / unsloth GGUF
 * mirrors (consistent single-file Q4_K_M naming). One-click installs; nothing
 * downloads until the user chooses.
 */

export interface CatalogFile {
  quant: string;
  url: string;
  approxBytes: number;
  minVramGB: number;
}
export interface CatalogModel {
  id: string;
  name: string;
  family: 'qwen' | 'deepseek' | 'gemma' | 'llama' | 'glm';
  params: string;
  description: string;
  license: string;
  roles: string[];
  requiresManualAccess: boolean;
  manualUrl?: string;
  files: CatalogFile[];
}

const GB = 1024 ** 3;
const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;
const m = (id: string, name: string, family: any, params: string, description: string, license: string, roles: string[], repo: string, file: string, approxBytes: number, minVramGB: number): CatalogModel => ({
  id, name, family, params, description, license, roles, requiresManualAccess: false,
  files: [{ quant: 'Q4_K_M', url: hf(repo, file), approxBytes, minVramGB }],
});

export const CATALOG: CatalogModel[] = [
  // --- Qwen ---
  m('qwen2.5-7b-instruct', 'Qwen2.5 7B Instruct', 'qwen', '7B', 'Fast, capable general chat. Great default for a 16 GB GPU.', 'Apache-2.0', ['fast', 'chat'],
    'bartowski/Qwen2.5-7B-Instruct-GGUF', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', 4.7 * GB, 6),
  m('qwen2.5-coder-7b', 'Qwen2.5 Coder 7B Instruct', 'qwen', '7B', 'Strong local coding assistant. Recommended coder for the 4080.', 'Apache-2.0', ['coding'],
    'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', 'qwen2.5-coder-7b-instruct-q4_k_m.gguf', 4.7 * GB, 6),
  m('qwen2.5-14b-instruct', 'Qwen2.5 14B Instruct', 'qwen', '14B', 'Higher quality, still fits fully in 16 GB VRAM at Q4.', 'Apache-2.0', ['chat', 'reasoning'],
    'bartowski/Qwen2.5-14B-Instruct-GGUF', 'Qwen2.5-14B-Instruct-Q4_K_M.gguf', 9 * GB, 11),
  m('qwen2.5-coder-32b', 'Qwen2.5 Coder 32B Instruct', 'qwen', '32B', 'Top-tier local coder. Partial GPU offload + RAM on 16 GB.', 'Apache-2.0', ['coding', 'reasoning'],
    'bartowski/Qwen2.5-Coder-32B-Instruct-GGUF', 'Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf', 20 * GB, 22),
  m('qwen3-coder-30b', 'Qwen3 Coder 30B A3B', 'qwen', '30B MoE', 'Newer Qwen3 coding model (MoE — small active params, fast).', 'Apache-2.0', ['coding', 'reasoning'],
    'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf', 18.6 * GB, 20),
  m('qwen3-30b-a3b', 'Qwen3 30B A3B', 'qwen', '30B MoE', 'Qwen3 general MoE — strong reasoning, efficient.', 'Apache-2.0', ['reasoning', 'chat'],
    'bartowski/Qwen_Qwen3-30B-A3B-GGUF', 'Qwen_Qwen3-30B-A3B-Q4_K_M.gguf', 18.6 * GB, 20),

  // --- DeepSeek (R1 distills — the DeepSeek models that actually run locally) ---
  m('deepseek-r1-distill-qwen-7b', 'DeepSeek-R1 Distill Qwen 7B', 'deepseek', '7B', 'Reasoning-tuned distill. Fits fully on the 4080.', 'MIT (distill)', ['reasoning'],
    'bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF', 'DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf', 4.7 * GB, 6),
  m('deepseek-r1-distill-qwen-14b', 'DeepSeek-R1 Distill Qwen 14B', 'deepseek', '14B', 'Stronger reasoning distill, fits 16 GB at Q4.', 'MIT (distill)', ['reasoning'],
    'bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF', 'DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf', 9 * GB, 11),
  m('deepseek-r1-distill-qwen-32b', 'DeepSeek-R1 Distill Qwen 32B', 'deepseek', '32B', 'The strongest DeepSeek that runs on a 4080 (partial offload). Closest to a "DeepSeek pro" locally.', 'MIT (distill)', ['reasoning'],
    'bartowski/DeepSeek-R1-Distill-Qwen-32B-GGUF', 'DeepSeek-R1-Distill-Qwen-32B-Q4_K_M.gguf', 20 * GB, 22),
  m('deepseek-r1-distill-llama-8b', 'DeepSeek-R1 Distill Llama 8B', 'deepseek', '8B', 'Llama-based reasoning distill.', 'MIT (distill)', ['reasoning'],
    'bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF', 'DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf', 4.9 * GB, 6),

  // --- Gemma / Llama / GLM ---
  m('gemma-2-9b-it', 'Gemma 2 9B Instruct', 'gemma', '9B', 'Google open-weight model. Strong general assistant.', 'Gemma', ['chat'],
    'bartowski/gemma-2-9b-it-GGUF', 'gemma-2-9b-it-Q4_K_M.gguf', 5.8 * GB, 8),
  m('llama-3.1-8b-instruct', 'Llama 3.1 8B Instruct', 'llama', '8B', "Meta's widely-used open-weight model.", 'Llama 3.1 Community', ['chat'],
    'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf', 4.9 * GB, 6),
  m('glm-4-9b-chat', 'GLM-4 9B Chat', 'glm', '9B', 'THUDM open-weight chat model.', 'GLM', ['chat'],
    'bartowski/glm-4-9b-chat-GGUF', 'glm-4-9b-chat-Q4_K_M.gguf', 6.3 * GB, 8),
];

export function getCatalog() {
  return CATALOG;
}
export default { getCatalog, CATALOG };
