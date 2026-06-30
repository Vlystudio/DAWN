/**
 * modelMetadata.ts — pure model intelligence: parse a model identifier (GGUF filename or
 * Ollama tag), look up family metadata + a friendly DAWN name, and estimate hardware
 * requirements. Unknown models degrade gracefully (estimated from the name). No electron.
 *
 * The ACTUAL backend identifier is never lost — friendly names are additive.
 */
import { Category, ModelMetadata, ParsedModel } from './optimizerTypes';

// --- quantization → GB per billion params (calibrated to real GGUF sizes) --
const BPP: Record<string, number> = {
  Q2_K: 0.40, Q3_K_S: 0.46, Q3_K_M: 0.50, Q3_K_L: 0.54, IQ4_XS: 0.55, IQ4_NL: 0.57,
  Q4_0: 0.58, Q4_K_S: 0.59, Q4_K_M: 0.62, Q5_0: 0.69, Q5_K_S: 0.69, Q5_K_M: 0.73,
  Q6_K: 0.83, Q8_0: 1.06, F16: 2.0, BF16: 2.0, F32: 4.0,
};
export function bytesPerParamGB(quant: string): number {
  const q = (quant || '').toUpperCase();
  if (BPP[q]) return BPP[q];
  if (q.startsWith('Q4')) return 0.62;
  if (q.startsWith('Q5')) return 0.72;
  if (q.startsWith('Q6')) return 0.83;
  if (q.startsWith('Q8')) return 1.06;
  if (q.startsWith('Q3')) return 0.50;
  if (q.startsWith('Q2')) return 0.40;
  if (q.startsWith('IQ4')) return 0.56;
  if (q.startsWith('F16') || q.startsWith('BF16')) return 2.0;
  return 0.62; // assume a Q4_K_M-ish default
}

// --- family detection (most specific first) --------------------------------
const FAMILY_PATTERNS: [RegExp, string][] = [
  [/tinyllama/i, 'tinyllama'],   // must precede the generic llama patterns below
  [/qwen\s*2\.5[-_ ]?coder/i, 'qwen2.5-coder'],
  [/qwen\s*3[-_ ]?coder/i, 'qwen3-coder'],
  [/qwen\s*2[-_ ]?coder/i, 'qwen2-coder'],
  [/qwq/i, 'qwq'],
  [/deepseek[-_ ]?r1/i, 'deepseek-r1'],
  [/deepseek[-_ ]?coder/i, 'deepseek-coder'],
  [/deepseek/i, 'deepseek'],
  [/qwen\s*3/i, 'qwen3'],
  [/qwen\s*2\.5/i, 'qwen2.5'],
  [/qwen\s*2/i, 'qwen2'],
  [/qwen/i, 'qwen'],
  [/codellama|code[-_ ]?llama/i, 'codellama'],
  [/llama[-_ ]?3\.3/i, 'llama3.3'],
  [/llama[-_ ]?3\.2/i, 'llama3.2'],
  [/llama[-_ ]?3\.1/i, 'llama3.1'],
  [/llama[-_ ]?3/i, 'llama3'],
  [/llama[-_ ]?2/i, 'llama2'],
  [/llama/i, 'llama'],
  [/mixtral/i, 'mixtral'],
  [/mistral/i, 'mistral'],
  [/starcoder\s*2|starcoder2/i, 'starcoder2'],
  [/starcoder/i, 'starcoder'],
  [/gemma\s*2|gemma2/i, 'gemma2'],
  [/gemma/i, 'gemma'],
  [/phi[-_ ]?3|phi3/i, 'phi3'],
  [/phi/i, 'phi'],
  [/tinyllama/i, 'tinyllama'],
  [/nomic[-_ ]?embed/i, 'nomic-embed'],
  [/mxbai[-_ ]?embed/i, 'mxbai-embed'],
  [/bge[-_ ]?(large|small|base|m3)/i, 'bge'],
  [/all[-_ ]?minilm/i, 'minilm'],
  [/llava/i, 'llava'],
  [/glm/i, 'glm'],
];

const EMBED_RE = /embed|nomic|mxbai|bge|minilm/i;
const VISION_RE = /llava|[-_ ]vl[-_ ]|vision|moondream|bakllava/i;

function detectQuant(name: string): string {
  const m = name.match(/\b(IQ\d[\w]*|Q\d(_[\w]+)*|BF16|F16|F32)\b/i);
  return m ? m[1].toUpperCase() : 'unknown';
}

/** Parse a filename or ollama tag into {family, paramsB, isMoE, quant, ...}. */
export function parseModelId(id: string): ParsedModel {
  const raw = String(id || '');
  const base = raw.replace(/\.gguf$/i, '');
  const lc = base.toLowerCase();

  // MoE active params, e.g. "30b-a3b" (Qwen3 MoE) or "8x7b" (Mixtral)
  let paramsB = 0, activeB: number | undefined, isMoE = false;
  const moeA = lc.match(/(\d+(?:\.\d+)?)\s*b[-_ ]?a(\d+(?:\.\d+)?)\s*b?/i);  // 30b-a3b
  const moeX = lc.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b/i);                  // 8x7b
  if (moeA) { paramsB = Number(moeA[1]); activeB = Number(moeA[2]); isMoE = true; }
  else if (moeX) { const e = Number(moeX[1]); const per = Number(moeX[2]); paramsB = Math.round(e * per * 0.62); activeB = Math.round(per * 2); isMoE = true; }
  else {
    const sz = lc.match(/(\d+(?:\.\d+)?)\s*b\b/);
    if (sz) paramsB = Number(sz[1]);
  }
  // mixtral default if no size token
  let family = 'unknown';
  for (const [re, f] of FAMILY_PATTERNS) { if (re.test(lc)) { family = f; break; } }
  if (family === 'mixtral' && !paramsB) { paramsB = 47; activeB = 13; isMoE = true; }
  if (family === 'mistral' && !paramsB) paramsB = 7;
  if (family === 'phi' && !paramsB) paramsB = 3.8;
  if (family === 'tinyllama' && !paramsB) paramsB = 1.1;
  if (family === 'gemma' && !paramsB) paramsB = 7;
  if (/codellama/.test(family) && !paramsB) paramsB = 7;
  if (/starcoder/.test(family) && !paramsB) paramsB = 7;

  return {
    raw, family, paramsB, activeB, isMoE,
    quant: detectQuant(base),
    isEmbedding: EMBED_RE.test(lc),
    isVision: VISION_RE.test(lc),
  };
}

// --- family knowledge ------------------------------------------------------
interface FamilyInfo { category: Category; purpose: string; bestFor: string[]; strengths: string[]; weaknesses: string[]; tags: string[]; }
const FAMILIES: Record<string, FamilyInfo> = {
  'qwen2.5-coder': { category: 'Coding', purpose: 'Advanced coding, debugging, refactoring, software architecture', bestFor: ['debugging', 'refactoring', 'architecture', 'code review'], strengths: ['strong code generation', 'multi-language', 'good at fixes'], weaknesses: ['heavier at larger sizes'], tags: ['code', 'tools'] },
  'qwen3-coder': { category: 'Coding', purpose: 'Fast modern coding (MoE — small active params)', bestFor: ['coding', 'refactoring', 'agentic coding'], strengths: ['fast for its size (MoE)', 'modern training'], weaknesses: ['MoE needs full weights in memory'], tags: ['code', 'moe', 'tools'] },
  'qwen2-coder': { category: 'Coding', purpose: 'Coding assistant', bestFor: ['coding', 'bug fixing'], strengths: ['solid code'], weaknesses: ['older'], tags: ['code'] },
  'deepseek-coder': { category: 'Coding', purpose: 'Code generation and repair', bestFor: ['coding', 'completion'], strengths: ['code-focused'], weaknesses: ['less general'], tags: ['code'] },
  'codellama': { category: 'Coding', purpose: 'Code explanation, repair, and local software development', bestFor: ['code explanation', 'repair', 'completion'], strengths: ['well-known', 'stable'], weaknesses: ['older than Qwen-coder'], tags: ['code'] },
  'starcoder': { category: 'Coding', purpose: 'Code generation, completion, and technical assistance', bestFor: ['completion', 'generation'], strengths: ['code completion'], weaknesses: ['weaker chat'], tags: ['code'] },
  'starcoder2': { category: 'Coding', purpose: 'Code generation and completion', bestFor: ['completion', 'generation'], strengths: ['strong completion'], weaknesses: ['weaker chat'], tags: ['code'] },
  'deepseek-r1': { category: 'Reasoning', purpose: 'Step-by-step reasoning, math, planning, problem solving', bestFor: ['reasoning', 'math', 'planning', 'decomposition'], strengths: ['shows its work', 'strong logic'], weaknesses: ['verbose', 'slower (thinking tokens)'], tags: ['reasoning', 'math'] },
  'qwq': { category: 'Reasoning', purpose: 'Reasoning-focused problem solving', bestFor: ['reasoning', 'math'], strengths: ['deliberate reasoning'], weaknesses: ['verbose'], tags: ['reasoning'] },
  'deepseek': { category: 'General Assistant', purpose: 'General assistant and reasoning', bestFor: ['chat', 'reasoning'], strengths: ['capable'], weaknesses: [], tags: ['general'] },
  'qwen3': { category: 'General Assistant', purpose: 'General intelligence, research, multilingual reasoning', bestFor: ['research', 'reasoning', 'multilingual', 'tools'], strengths: ['modern', 'good tool use', 'multilingual'], weaknesses: [], tags: ['general', 'reasoning', 'tools'] },
  'qwen2.5': { category: 'General Assistant', purpose: 'General assistant, reasoning, multilingual', bestFor: ['chat', 'research', 'summarization'], strengths: ['well-rounded', 'tool use'], weaknesses: [], tags: ['general', 'tools'] },
  'qwen2': { category: 'General Assistant', purpose: 'General assistant', bestFor: ['chat'], strengths: ['solid'], weaknesses: ['older'], tags: ['general'] },
  'qwen': { category: 'General Assistant', purpose: 'General assistant', bestFor: ['chat'], strengths: ['solid'], weaknesses: ['older'], tags: ['general'] },
  'llama3.3': { category: 'Reasoning', purpose: 'High-quality reasoning and conversation', bestFor: ['reasoning', 'planning', 'chat'], strengths: ['strong reasoning at 70B'], weaknesses: ['large'], tags: ['general', 'reasoning'] },
  'llama3.1': { category: 'General Assistant', purpose: 'Fast everyday assistant (8B) / deep reasoning (70B)', bestFor: ['chat', 'reasoning', 'tools'], strengths: ['well-rounded', 'tool use', 'long context'], weaknesses: [], tags: ['general', 'tools', 'long-context'] },
  'llama3.2': { category: 'Lightweight/Fast', purpose: 'Lightweight fast assistant', bestFor: ['fast chat', 'low-resource'], strengths: ['tiny and fast'], weaknesses: ['less capable'], tags: ['general', 'fast'] },
  'llama3': { category: 'General Assistant', purpose: 'General assistant', bestFor: ['chat'], strengths: ['solid'], weaknesses: [], tags: ['general'] },
  'llama2': { category: 'General Assistant', purpose: 'Older general assistant', bestFor: ['chat'], strengths: ['stable'], weaknesses: ['outdated'], tags: ['general'] },
  'llama': { category: 'General Assistant', purpose: 'General assistant', bestFor: ['chat'], strengths: [], weaknesses: [], tags: ['general'] },
  'mistral': { category: 'General Assistant', purpose: 'Fast general reasoning and summarization', bestFor: ['fast chat', 'summarization'], strengths: ['fast', 'efficient'], weaknesses: ['smaller knowledge'], tags: ['general', 'fast'] },
  'mixtral': { category: 'Reasoning', purpose: 'Mixture-of-experts broad reasoning', bestFor: ['reasoning', 'broad knowledge'], strengths: ['MoE quality', 'fast active params'], weaknesses: ['needs lots of VRAM/RAM for full weights'], tags: ['general', 'moe', 'reasoning'] },
  'gemma2': { category: 'General Assistant', purpose: 'Lightweight general assistant', bestFor: ['chat', 'summarization'], strengths: ['efficient', 'good small'], weaknesses: [], tags: ['general', 'fast'] },
  'gemma': { category: 'Lightweight/Fast', purpose: 'Lightweight general assistant', bestFor: ['chat'], strengths: ['efficient'], weaknesses: ['smaller'], tags: ['general', 'fast'] },
  'phi3': { category: 'Lightweight/Fast', purpose: 'Very lightweight quick responses', bestFor: ['fast chat', 'low-resource'], strengths: ['tiny', 'punches above weight'], weaknesses: ['limited depth'], tags: ['fast'] },
  'phi': { category: 'Lightweight/Fast', purpose: 'Very lightweight quick responses', bestFor: ['fast chat'], strengths: ['tiny'], weaknesses: ['limited'], tags: ['fast'] },
  'tinyllama': { category: 'Lightweight/Fast', purpose: 'Ultra-lightweight fallback assistant', bestFor: ['low-resource', 'fallback'], strengths: ['runs anywhere'], weaknesses: ['limited capability'], tags: ['fast', 'tiny'] },
  'nomic-embed': { category: 'Embeddings', purpose: 'Embeddings, search, RAG, long-term memory', bestFor: ['embeddings', 'RAG', 'search'], strengths: ['fast', 'good retrieval'], weaknesses: ['not a chat model'], tags: ['embeddings', 'rag'] },
  'mxbai-embed': { category: 'Embeddings', purpose: 'Higher-quality embeddings and semantic search', bestFor: ['embeddings', 'semantic search'], strengths: ['high-quality retrieval'], weaknesses: ['not a chat model'], tags: ['embeddings', 'rag'] },
  'bge': { category: 'Embeddings', purpose: 'Embeddings and semantic search', bestFor: ['embeddings', 'RAG'], strengths: ['good retrieval'], weaknesses: ['not a chat model'], tags: ['embeddings', 'rag'] },
  'minilm': { category: 'Embeddings', purpose: 'Lightweight embeddings', bestFor: ['embeddings'], strengths: ['tiny'], weaknesses: ['lower quality'], tags: ['embeddings'] },
  'llava': { category: 'Vision', purpose: 'Image understanding and visual reasoning', bestFor: ['image analysis', 'visual reasoning'], strengths: ['multimodal'], weaknesses: ['needs an mmproj file'], tags: ['vision', 'multimodal'] },
  'glm': { category: 'General Assistant', purpose: 'General assistant', bestFor: ['chat'], strengths: [], weaknesses: [], tags: ['general'] },
};

// --- friendly names (per family + size bucket; falls back to family/generic) -
const NAMES: Record<string, Record<number, string>> = {
  'qwen2.5-coder': { 7: 'Code Smith', 14: 'Code Pilot', 32: 'Code Forge' },
  'qwen3-coder': { 30: 'Code Forge Pro' },
  'qwen3': { 8: 'Atlas Lite', 14: 'Atlas', 30: 'Atlas Flow', 32: 'Atlas Pro' },
  'qwen2.5': { 3: 'Sage Mini', 7: 'Sage', 14: 'Sage Plus', 32: 'Sage Pro', 72: 'Sage Max' },
  'deepseek-r1': { 7: 'Logic Spark', 8: 'Logic Spark', 14: 'Logic Engine', 32: 'Reason Core', 70: 'Reason Prime' },
  'llama3.1': { 8: 'QuickMind', 70: 'Deep Counsel' },
  'llama3.3': { 70: 'Deep Counsel' },
  'llama3.2': { 1: 'QuickMind Nano', 3: 'QuickMind Mini' },
  'gemma2': { 2: 'BrightSpark', 9: 'BrightSpark Plus', 27: 'BrightSpark Pro' },
  'gemma': { 2: 'BrightSpark', 7: 'BrightSpark Plus' },
  'codellama': { 7: 'Debug Warden', 13: 'Debug Warden', 34: 'Debug Warden Pro' },
};
const NAME_FLAT: Record<string, string> = {
  mistral: 'Swift Scholar', mixtral: 'CouncilMind', starcoder: 'Syntax Smith', starcoder2: 'Syntax Smith',
  phi: 'Pocket Brain', phi3: 'Pocket Brain', tinyllama: 'Ember',
  'nomic-embed': 'Memory Indexer', 'mxbai-embed': 'Deep Indexer', bge: 'Semantic Indexer', minilm: 'Memory Indexer Lite',
  llava: 'Vision Scout', qwq: 'Deep Reasoner',
};
function titleCase(s: string) { return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim(); }
function friendlyName(p: ParsedModel): string {
  const bySize = NAMES[p.family];
  if (bySize) {
    const bucket = nearestBucket(p.paramsB, Object.keys(bySize).map(Number));
    if (bucket != null && bySize[bucket]) return bySize[bucket];
  }
  if (NAME_FLAT[p.family]) return NAME_FLAT[p.family];
  // generic but useful
  if (p.family !== 'unknown') return `${titleCase(p.family)}${p.paramsB ? ' ' + sizeLabel(p) : ''}`;
  return titleCase(p.raw.replace(/\.gguf$/i, '').replace(/[-_.]?(instruct|chat|gguf|q\d.*|f16|bf16)$/i, '')) || 'Local Model';
}
function nearestBucket(v: number, buckets: number[]): number | null {
  if (!buckets.length) return null;
  return buckets.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
}
function sizeLabel(p: ParsedModel): string { return p.isMoE && p.activeB ? `${p.paramsB}B-A${p.activeB}B` : `${p.paramsB}B`; }

// --- requirement estimation ------------------------------------------------
export function kvCacheGB(contextTok: number, paramsB: number): number {
  const per1k = 0.06 * Math.max(0.4, paramsB / 7);     // ~0.06 GB/1K tokens for a 7B
  return Math.max(0.05, (contextTok / 1000) * per1k);
}
function recommendedContext(family: string, paramsB: number): number {
  if (EMBED_RE.test(family)) return 2048;
  if (paramsB >= 30) return 8192;
  return 8192;
}

/** Build full metadata (with derived requirement estimates) for a model id. */
export function identify(modelId: string): ModelMetadata {
  const p = parseModelId(modelId);
  const fam = FAMILIES[p.family];
  const known = !!fam && p.family !== 'unknown';
  const info: FamilyInfo = fam || {
    category: p.isEmbedding ? 'Embeddings' : p.isVision ? 'Vision' : 'General Assistant',
    purpose: p.isEmbedding ? 'Embeddings / retrieval' : p.isVision ? 'Image understanding' : 'General assistant',
    bestFor: p.isEmbedding ? ['embeddings', 'RAG'] : ['chat'],
    strengths: [], weaknesses: [], tags: p.isEmbedding ? ['embeddings'] : ['general'],
  };
  const ctx = recommendedContext(p.family, p.paramsB);
  const bpp = bytesPerParamGB(p.quant);
  const weightsGB = Math.max(0.2, p.paramsB * bpp);
  const estMinVramGB = round1(weightsGB + kvCacheGB(4096, p.paramsB) + 0.7);
  const estComfortVramGB = round1(weightsGB + kvCacheGB(ctx, p.paramsB) + 1.3);
  const estRamGB = round1(weightsGB + 2);

  return {
    friendlyName: friendlyName(p),
    actualName: p.raw,
    family: p.family,
    category: p.isEmbedding ? 'Embeddings' : p.isVision ? 'Vision' : info.category,
    paramsB: p.paramsB, activeB: p.activeB, isMoE: p.isMoE, quant: p.quant,
    purpose: info.purpose, bestFor: info.bestFor, strengths: info.strengths, weaknesses: info.weaknesses, tags: info.tags,
    recommendedContext: ctx, recommendedBackend: p.isEmbedding ? 'either' : 'gpu',
    estMinVramGB, estComfortVramGB, estRamGB, known,
  };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

export const KNOWN_MODELS = [
  'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b', 'qwen3:14b',
  'llama3.1:8b', 'llama3.1:70b', 'deepseek-r1:7b', 'deepseek-r1:14b', 'deepseek-r1:32b',
  'mistral', 'mixtral', 'codellama', 'starcoder', 'gemma', 'phi', 'tinyllama',
  'nomic-embed-text', 'mxbai-embed-large', 'llava',
];

export default { parseModelId, identify, bytesPerParamGB, kvCacheGB, KNOWN_MODELS };
