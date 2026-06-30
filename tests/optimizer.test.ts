/**
 * Tests for the DAWN Model Optimizer core (pure modules — no electron, no real hardware).
 * Covers: model-id parsing, friendly-name + metadata lookup, the unknown-model fallback,
 * compatibility scoring against two reference machines (RTX 4080 SUPER + 64 GB, and a
 * CPU-only 16 GB box), and settings generation mapping onto llama.cpp args.
 * Run: npm run test:agentos
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { parseModelId, identify } from '../electron/services/optimizer/modelMetadata';
import { scoreCompatibility } from '../electron/services/optimizer/compatibilityScorer';
import { optimize } from '../electron/services/optimizer/settingsOptimizer';
import { HardwareProfile } from '../electron/services/optimizer/optimizerTypes';

// --- reference hardware ----------------------------------------------------
const RTX: HardwareProfile = {
  os: 'Windows', cpuName: 'AMD Ryzen 9', cpuCores: 16, cpuThreads: 32,
  totalRamGB: 64, availableRamGB: 50,
  gpus: [{ name: 'NVIDIA GeForce RTX 4080 SUPER', vramGB: 16, vendor: 'nvidia', cudaAvailable: true }],
  diskFreeGB: 500,
  backends: { ollama: true, llamaCpp: true, cuda: true, cpuOnly: false },
};
const CPU16: HardwareProfile = {
  os: 'Windows', cpuName: 'Intel i5', cpuCores: 4, cpuThreads: 8,
  totalRamGB: 16, availableRamGB: 12,
  gpus: [],
  backends: { llamaCpp: true, cpuOnly: true },
};

// --- parsing ---------------------------------------------------------------
test('parseModelId reads family / size / quant from gguf filenames and ollama tags', () => {
  const a = parseModelId('Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf');
  assert.equal(a.family, 'qwen2.5-coder');
  assert.equal(a.paramsB, 7);
  assert.equal(a.quant, 'Q4_K_M');
  assert.equal(a.isEmbedding, false);

  const b = parseModelId('qwen2.5-coder:32b');
  assert.equal(b.family, 'qwen2.5-coder');
  assert.equal(b.paramsB, 32);

  const moe = parseModelId('mixtral');
  assert.equal(moe.isMoE, true);
  assert.ok(moe.paramsB > 30);

  const moe2 = parseModelId('Qwen3-30B-A3B-Q4_K_M.gguf');
  assert.equal(moe2.isMoE, true);
  assert.equal(moe2.paramsB, 30);
  assert.equal(moe2.activeB, 3);
});

// --- friendly names + metadata --------------------------------------------
test('identify maps backend names to friendly DAWN names and keeps the real name', () => {
  const code = identify('Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf');
  assert.equal(code.friendlyName, 'Code Smith');
  assert.equal(code.actualName, 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf'); // never lost
  assert.equal(code.category, 'Coding');
  assert.equal(code.known, true);

  assert.equal(identify('qwen2.5-coder:32b').friendlyName, 'Code Forge');
  assert.equal(identify('qwen2.5-coder:14b').friendlyName, 'Code Pilot');
  assert.equal(identify('llama3.1:8b').friendlyName, 'QuickMind');
  assert.equal(identify('llama3.1:70b').friendlyName, 'Deep Counsel');
  assert.equal(identify('qwen3:14b').friendlyName, 'Atlas');

  const r1 = identify('deepseek-r1:14b');
  assert.equal(r1.friendlyName, 'Logic Engine');
  assert.equal(r1.category, 'Reasoning');

  assert.equal(identify('mistral').friendlyName, 'Swift Scholar');
  assert.equal(identify('mixtral').friendlyName, 'CouncilMind');
  assert.equal(identify('codellama').friendlyName, 'Debug Warden');
  assert.equal(identify('starcoder').friendlyName, 'Syntax Smith');
  assert.equal(identify('phi').friendlyName, 'Pocket Brain');
  assert.equal(identify('tinyllama').friendlyName, 'Ember');
  assert.equal(identify('llava').friendlyName, 'Vision Scout');

  const emb = identify('nomic-embed-text');
  assert.equal(emb.friendlyName, 'Memory Indexer');
  assert.equal(emb.category, 'Embeddings');
  assert.equal(identify('mxbai-embed-large').friendlyName, 'Deep Indexer');
});

test('unknown models degrade gracefully (estimated, not crashing)', () => {
  const u = identify('SomeBrandNew-9B-Q4_K_M.gguf');
  assert.equal(u.known, false);
  assert.equal(u.paramsB, 9);
  assert.ok(u.friendlyName.length > 0);
  assert.ok(u.estMinVramGB > 0);
  const c = scoreCompatibility(u, RTX);
  assert.ok(c.warnings.some((w) => /does not have full metadata/i.test(w)));
});

// --- compatibility: RTX 4080 SUPER + 64 GB ---------------------------------
test('RTX 4080 SUPER: 7B Excellent, 14B Excellent/Good, 32B Good/Borderline, 70B offloads', () => {
  const s7 = scoreCompatibility(identify('qwen2.5-coder:7b'), RTX);
  assert.equal(s7.level, 'Excellent');
  assert.equal(s7.fitsFullyOnGpu, true);

  const s14 = scoreCompatibility(identify('qwen3:14b'), RTX);
  assert.ok(['Excellent', 'Good'].includes(s14.level), `14B was ${s14.level}`);

  const s32 = scoreCompatibility(identify('qwen2.5-coder:32b'), RTX);
  assert.ok(['Good', 'Borderline'].includes(s32.level), `32B was ${s32.level}`);
  assert.equal(s32.needsCpuOffload, true);

  const s70 = scoreCompatibility(identify('llama3.1:70b'), RTX);
  assert.ok(['Borderline', 'CPU-only fallback', 'Not recommended'].includes(s70.level), `70B was ${s70.level}`);
});

// --- compatibility: CPU-only 16 GB -----------------------------------------
test('CPU-only 16 GB: tiny Good/Borderline, 14B Not recommended, 70B Unsupported', () => {
  const tiny = scoreCompatibility(identify('tinyllama'), CPU16);
  assert.ok(['Good', 'Borderline'].includes(tiny.level), `tiny was ${tiny.level}`);

  const phi = scoreCompatibility(identify('phi'), CPU16);
  assert.ok(['Good', 'Borderline'].includes(phi.level), `phi was ${phi.level}`);

  const s14 = scoreCompatibility(identify('qwen3:14b'), CPU16);
  assert.ok(['Not recommended', 'Unsupported'].includes(s14.level), `14B(cpu) was ${s14.level}`);

  const s70 = scoreCompatibility(identify('llama3.1:70b'), CPU16);
  assert.ok(['Unsupported', 'Not recommended'].includes(s70.level), `70B(cpu) was ${s70.level}`);
  assert.equal(s70.allowOverride, false);
});

// --- settings generation maps onto llama.cpp args --------------------------
test('settings: 7B on RTX = full GPU; 32B on RTX = partial; phi on CPU = cpu-only', () => {
  const m7 = identify('qwen2.5-coder:7b');
  const o7 = optimize(m7, RTX, 'Balanced', scoreCompatibility(m7, RTX));
  assert.equal(o7.settings.gpuLayers, 999);          // -ngl 999 (all)
  assert.equal(o7.settings.lowVram, false);
  assert.notEqual(o7.settings.performanceMode, 'cpu');
  assert.equal(o7.settings.contextLength, 8192);
  assert.ok(o7.changed.length > 0 && o7.explanation.includes('Code Smith'));

  const m32 = identify('qwen2.5-coder:32b');
  const o32 = optimize(m32, RTX, 'Balanced', scoreCompatibility(m32, RTX));
  assert.ok(o32.settings.gpuLayers > 0 && o32.settings.gpuLayers !== 999, `32B gpuLayers=${o32.settings.gpuLayers}`);
  assert.equal(o32.settings.lowVram, false);          // partial offload still uses the GPU

  const mp = identify('phi');
  const op = optimize(mp, CPU16, 'Balanced', scoreCompatibility(mp, CPU16));
  assert.equal(op.settings.gpuLayers, 0);
  assert.equal(op.settings.performanceMode, 'cpu');   // -ngl 0
  assert.equal(op.settings.lowVram, true);
});

test('coding models get low temperature; Quality widens context vs Safe', () => {
  const code = identify('qwen2.5-coder:7b');
  assert.ok(optimize(code, RTX, 'Balanced').settings.temperature <= 0.3);
  const q = optimize(code, RTX, 'Quality').settings.contextLength;
  const safe = optimize(code, RTX, 'Safe').settings.contextLength;
  assert.ok(q > safe, `Quality ctx ${q} should exceed Safe ctx ${safe}`);
});
