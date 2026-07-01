# DAWN — Model compatibility & recommendations

DAWN runs **GGUF** models via llama.cpp. One model is loaded at a time; switch in
**Model Hub** (Task routing → *Use now*) or **Model Manager** (Select + restart).

## Recommended set for an RTX 4080 Super (16 GB VRAM, 64 GB RAM)

| Role | Model | Quant | ~VRAM | Why |
|---|---|---|---|---|
| **Fast chat** | Qwen2.5 7B Instruct | Q4_K_M | ~6 GB | Snappy, fully on-GPU. |
| **Coding** | Qwen2.5 Coder 7B Instruct | Q4_K_M | ~6 GB | Best small local coder. |
| **Coding (max)** | Qwen2.5 Coder 32B Instruct | Q4_K_M | ~22 GB | Partial GPU offload + RAM; strong. |
| **General (better)** | Qwen2.5 14B Instruct | Q4_K_M | ~11 GB | Fits fully on the 4080 Super. |
| **Reasoning** | DeepSeek-R1 Distill Qwen 7B | Q4_K_M | ~6 GB | "Thinking" model. |
| **Heavyweight** | Qwen2.5 72B Instruct | Q4_K_M | 48 GB+ | Runs partially offloaded to 64 GB RAM (slower). |

Set **GPU layers (-ngl)** high (e.g. 999) for models that fit in VRAM; lower it
to offload to RAM for larger ones. Model Hub shows **“fits your GPU”** per quant.

## Compatibility matrix

| Family | In catalog | Direct download | License | Notes |
|---|---|---|---|---|
| Qwen2.5 (7B/14B/32B-Coder/72B) | ✅ | ✅ (official Qwen GGUF) | Apache-2.0 / Qwen | Recommended default family. |
| Qwen2.5 Coder (7B/32B) | ✅ | ✅ | Apache-2.0 | Best local coding. |
| Qwen3 Coder | ✅ | ⚠️ manual | Apache-2.0 | GGUF naming varies — pick a repo. |
| DeepSeek-R1 Distill (Qwen-7B) | ✅ | ✅ (community GGUF) | MIT (distill) | Reasoning. |
| DeepSeek-Coder-V2 Lite | ✅ | ✅ | DeepSeek | Efficient MoE coder. |
| Gemma 2 9B it | ✅ | ✅ (community GGUF) | Gemma | Google open-weight. |
| Llama 3.1 8B Instruct | ✅ | ✅ (community GGUF) | Llama 3.1 Community | Meta open-weight. |
| GLM-4 9B chat | ✅ | ⚠️ manual | GLM | Availability varies. |

✅ direct = downloadable without login. ⚠️ manual = shown as **“requires manual
access”** (open the HF page, accept the license / pick a repo, then **Import**).

> Quantization guide: **Q4_K_M** is the best size/quality default. Use **Q5/Q6**
> if it still fits VRAM for a quality bump; **Q3** to squeeze a bigger model in.

## Quant cheat-sheet (VRAM to run mostly on GPU)

| Params | Q4_K_M | Q6_K |
|---|---|---|
| 7–9B | 5–7 GB | 7–9 GB |
| 14B | ~10–11 GB | ~13 GB |
| 32B | ~20–22 GB (partial offload on 16 GB) | ~27 GB |
| 72B | ~47 GB (CPU+GPU split) | — |

## Model Cookbook

**Sidebar → Models → Model Cookbook** (or the "Open Model Cookbook" command).

The cookbook answers "which installed model is best for what, and will it run on my hardware" — using
**real data only**, never fabricated:

- **Best for each role** (Fast chat / Coding / Reasoning / Research / Long context / Embeddings /
  Vision) — derived from catalog role metadata + the optimizer's compatibility analysis. A role card
  only appears if a real installed model fits it.
- **Hardware fit label** per model from real compatibility scoring: *Fits in VRAM · Partial offload ·
  CPU fallback · Too large / not recommended · Unknown hardware*. If GPU/VRAM isn't detected it says
  **Unknown hardware** (it never guesses a fit).
- **Speed** shows the latest **real** benchmark tok/s, or **Needs benchmark** if you haven't run one.
- **Why** explains honestly: recommended (fits), may be slower (partial offload), not recommended
  (doesn't fit), or hardware-not-detected.

Apply recommended settings in the **Optimizer** (the cookbook is read-only; the Optimizer applies, and
never silently applies risky settings — manual override remains available).

Backend: `electron/services/optimizer/modelCookbook.ts` over the pure, tested `modelCookbookCore.ts`
(role normalization, fit labels, best-per-role). IPC `models:cookbook`.

## Vision models (for Vision Chat / image attachments)

Chat can accept image attachments (paste/drop/upload). Full image understanding needs a **vision-capable
GGUF + its `mmproj` projector** (e.g. Qwen2.5-VL, LLaVA, MiniCPM-V) plus the bundled multimodal runtime
`llama-mtmd-cli` (already in `resources/runtime`). Configure `vlmModelPath` + `vlmMmprojPath` (or the
**Vision** role). `parseModelId().isVision` detects vision GGUFs by name; `mmproj` files are stored in the
models folder but never listed as standalone models. If no vision model is configured, DAWN honestly says
it cannot see the image (it never guesses). See [VISION_CHAT.md](VISION_CHAT.md).

### Vision model setup (Model Cookbook)

The **Model Cookbook → "Vision Chat model"** panel configures the VLM used by Vision Chat: **auto-detect**
a VLM + `mmproj` pair from your model folder (scan is folder-scoped, never the whole disk; nothing applied
without confirmation), or pick each file manually. It shows a granular, honest status (not configured →
missing pieces → **Ready**) and a **Test Vision Model** button that runs the real `llama-mtmd-cli` on a
tiny image. File paths never leave the main process (only file names are shown). See [VISION_CHAT.md](VISION_CHAT.md).

### Reranker role (retrieval)

The Model Cookbook tracks a `reranker` role for an optional local cross-encoder that reorders retrieved
chunks. Until one is configured (`rerankerModelPath`), DAWN uses honest **heuristic hybrid ranking**
(reciprocal-rank fusion + title boost) and never claims cross-encoder reranking. See
[LOCAL_KNOWLEDGE.md](LOCAL_KNOWLEDGE.md).

### Retrieval helper roles + cross-encoder reranker status

Cookbook roles now include **query_rewriter / hyde_generator / entailment_verifier** (+ **reranker**). DAWN
runs one model at a time, so helper slots use the loaded chat model unless the configured helper *is* the
loaded model (honest fallback; see System Health → Retrieval Helper Models). **Cross-encoder reranker:**
none ships — `onnxruntime-node` is a heavy/brittle native dependency to bundle, and a GGUF reranker via a
second `llama-server --reranking` instance is the real future path. Today the real local rerank is
**embedding-similarity**; System Health reports cross-encoder as **NEEDS SETUP**, never faked.
