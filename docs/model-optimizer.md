# DAWN Model Optimizer

DAWN reads your hardware, scores every local model, gives each one a friendly name, and
auto-tunes its llama.cpp runtime settings. Open it from the **Optimizer** tab in the left rail.

> The real model identifier (the GGUF filename) is **never** hidden or replaced — friendly
> names are display-only. DAWN still loads models by their actual file on disk.

## What it does

1. **Hardware detection** — OS, CPU (name/cores/threads), RAM (total/usable), GPU(s) + VRAM,
   free disk, installed models, and which backends are available (CUDA / DirectML / Metal /
   ROCm / llama.cpp / Ollama / CPU). Unknown values show "Unknown" — nothing crashes.
2. **Model intelligence** — for each model it parses the family / parameter size / quantization
   from the filename or Ollama tag, looks up rich metadata (purpose, strengths, weaknesses,
   category, tags, requirement estimates), and assigns a memorable DAWN name (e.g.
   `Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf` → **Code Smith**). Unknown models still get a usable
   estimate from their name.
3. **Compatibility scoring** — one of **Excellent · Good · Borderline · CPU-only fallback ·
   Not recommended · Unsupported**, a 0–100 score, a plain-English reason, warnings, the
   recommended preset, and the expected speed.
4. **Automatic settings** — five presets (**Performance, Balanced, Quality, Safe, Low VRAM**)
   compute concrete `contextLength / gpuLayers / threads / batchSize / maxTokens / sampling`
   and explain what changed and the tradeoffs.
5. **Apply for real** — "Select & Load" writes the optimized settings into DAWN's settings
   store and hot-swaps the llama.cpp runtime to that model. "Optimize" saves the settings
   without loading.
6. **Task-aware** — pick a task (Coding / Chat / Reasoning / Research / Summarize / Memory-RAG /
   Vision / Security / Low-resource) and DAWN re-ranks your models by fit.
7. **Persistence** — DAWN remembers each model's last preset, exact settings, and whether you
   manually overrode the recommendation, along with the hardware it was tuned for. If your
   hardware changes, the card shows **"hardware changed — re-optimize"**.

## How settings map to the runtime

Optimized settings map 1:1 onto the args `electron/services/runtime.ts` builds:

```
-c <contextLength>   -t <threads>   -b <batchSize>
-ngl = (lowVram || performanceMode==='cpu') ? 0 : (gpuLayers || (performanceMode==='high' ? 999 : 0))
```

So the optimizer always sets an explicit `gpuLayers` number (**999 = all on GPU**, a partial
number = layer offload, **0** + `performanceMode:'cpu'` = CPU only). Apply = `settings.save({...})`
then `runtime.switchModel(path)` (which restarts `llama-server` with the new args).

## Compatibility logic (GGUF / llama.cpp memory model)

```
weightsGB  = paramsB × bytesPerParam(quant)        // Q4_K_M ≈ 0.62 GB/B
kvCacheGB  ≈ 0.06 GB per 1K tokens for a 7B, scaled by size
need       = weights + kv + runtime overhead
```

- `need` comfortably under VRAM → **Excellent** (runs fully on GPU)
- fits VRAM with little headroom → **Good**
- weights slightly over VRAM, rest offloads to RAM → **Borderline**
- far over VRAM but fits system RAM → **CPU-only fallback**
- doesn't fit VRAM+RAM → **Unsupported** (blocked); too slow to be useful → **Not recommended**
  (force-load allowed with a warning)

Example — **RTX 4080 SUPER (16 GB) + 64 GB RAM**: 7B → Excellent, 14B → Excellent, 32B coder →
Borderline (partial offload), 70B → CPU-only fallback. **CPU-only 16 GB**: TinyLlama → Good,
Phi → Borderline, 14B → Not recommended, 70B → Unsupported.

## Friendly names (samples)

| Backend | DAWN name | Backend | DAWN name |
|---|---|---|---|
| qwen2.5-coder:7b | Code Smith | deepseek-r1:14b | Logic Engine |
| qwen2.5-coder:14b | Code Pilot | deepseek-r1:32b | Reason Core |
| qwen2.5-coder:32b | Code Forge | mistral | Swift Scholar |
| qwen3:14b | Atlas | mixtral | CouncilMind |
| llama3.1:8b | QuickMind | codellama | Debug Warden |
| llama3.1:70b | Deep Counsel | starcoder | Syntax Smith |
| gemma:2b | BrightSpark | phi | Pocket Brain |
| tinyllama | Ember | llava | Vision Scout |
| nomic-embed-text | Memory Indexer | mxbai-embed-large | Deep Indexer |

## Adding a model to the database

Edit [electron/services/optimizer/modelMetadata.ts](../electron/services/optimizer/modelMetadata.ts):

- **Family knowledge** → add to `FAMILIES` (category, purpose, bestFor, strengths, weaknesses, tags).
- **Friendly name** → add to `NAMES` (per size bucket) or `NAME_FLAT` (one name for the family).
- **Family detection** → add a regex to `FAMILY_PATTERNS` (most specific first; put anything
  containing `llama` *above* the generic `/llama/i` pattern).

No other file needs to change — scoring and settings are derived from parameter size +
quantization, so a new model works immediately, and any unrecognised model still falls back to
a name- and hardware-based estimate.

## Files

```
electron/services/optimizer/
  optimizerTypes.ts            shared types
  modelMetadata.ts             parse id, friendly names, family DB, requirement estimates
  compatibilityScorer.ts       level / score / reason / warnings / recommended preset
  settingsOptimizer.ts         5 presets → concrete llama.cpp settings + explanation
  hardwareDetectionService.ts  full HardwareProfile (CPU/RAM/GPU/VRAM/backends/disk)
  optimizerStorage.ts          per-model persistence + hardware-hash re-optimize detection
  optimizer.ts                 service: analyze / list / apply(+load) / recommendForTask
src/components/ModelOptimizer.tsx   the Optimizer tab UI
tests/optimizer.test.ts             core unit tests (run: npm run test:agentos)
```

IPC: `window.dawn.optimizer.{hardware, list, analyze, previewModes, apply, resetToRecommended,
setManualOverride, reoptimizeNeeded, recommendForTask}`.

## Safety

- **Unsupported** models can't be loaded (no force). **Not recommended** models require an
  explicit force-load with a warning.
- Manual overrides are clamped (context, gpu layers, threads, batch, sampling) so a typo can't
  crash `llama-server`.
- Recommended-but-unsupported knobs (flash-attention, KV-cache quantization, parallel requests)
  are listed as **Notes** and skipped — DAWN never passes args its runtime can't honor.

## Testing

`npm run test:agentos` runs `tests/optimizer.test.ts`: model-id parsing, friendly-name +
metadata lookup, the unknown-model fallback, compatibility scoring on both reference machines,
and settings generation. All pure — no real hardware or model files needed.
