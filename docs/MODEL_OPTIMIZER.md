# DAWN Model Optimizer, Benchmarking & Model Health

Hardware-aware model optimization for DAWN's local llama.cpp runtime: detect the machine,
compute recommended settings per model and task, benchmark real throughput, rank models for
*this* PC, and label every model by its true purpose + GPU fit. Clean-room, DAWN-native.

See also: [COMPARE.md](COMPARE.md) (Model Arena) and the in-app **Optimizer** (🎛️),
**Compare** (⚔️), **Models**, and **Model Hub** screens.

## 1. Hardware detection

`optimizer/hardwareDetectionService.ts` builds a full profile: OS, CPU (name/cores/threads),
RAM (total/usable), GPU(s) + VRAM (NVIDIA via `nvidia-smi`, others best-effort), free disk,
installed GGUFs, and backend availability (CUDA / DirectML / Metal / ROCm / llama.cpp /
Ollama / CPU). Unknown values render as "Unknown" — never a crash.

## 2. Recommended settings (per model × task)

For each model the optimizer computes concrete llama.cpp settings and maps them onto the
real runtime args:

| Setting | Arg | Notes |
|---|---|---|
| Context length | `-c` | capped per preset and to the model's recommended window |
| GPU layers | `-ngl` | layer-fit math (999 = all, partial = offload, 0 = CPU) |
| Threads | `-t` | few when fully on GPU, physical cores otherwise |
| Batch / micro-batch | `-b` / `-ub` | ubatch ≈ half batch (smaller on tight VRAM) |
| mmap / mlock | `--no-mmap` / `--mlock` | mmap on by default; mlock when RAM is comfortable |
| Sampling | temp / top-p / top-k / repeat | **temperature defaults by task** (see below) |

**Presets:** Performance · Balanced · Quality · Safe · Low VRAM. Each explains *what changed*
and the *tradeoffs*. **Tasks:** Fast Chat, Coding, Reasoning, Research, Embeddings, Long
Context — `recommendForTask()` ranks installed models by fit, and task drives temperature
(Coding ≈ 0.2, Reasoning ≈ 0.3, Chat ≈ 0.7, Creative ≈ 0.9, Embeddings = 0).

Everything is **overridable** in **Advanced settings** (including ubatch/mmap/mlock), with
**"Reset to DAWN recommendation."** Overrides are stored locally per model
(`optimizer-state.json`) along with the hardware hash, so DAWN can flag *"hardware changed —
re-optimize."*

### Example — RTX 4080 SUPER (16 GB) + 64 GB, Windows

- **Qwen 7B / Coder 7B** → Excellent, full GPU (`-ngl 999`), 8K ctx, `-b 512 -ub 256`,
  temp 0.2 (coder).
- **Qwen 14B** → Excellent, full GPU, 8K ctx.
- **Qwen2.5-Coder 32B** → Borderline, partial offload (≈40 of 64 layers), rest on RAM.
- **70B** → CPU-only fallback (fits 64 GB RAM, slow).

## 3. Friendly names + true labels (names preserved)

Every model keeps its **real GGUF name** and gains a **DAWN nickname / function label**
(e.g. *Code Forge*, *Atlas*, *Reason Core*, *Memory Indexer*). Labels appear in the
Optimizer, the Chat model dropdown, and the **Model Hub** — the actual filename is always
shown alongside (hover for the raw name).

## 4. Benchmarking ("Best for this PC")

**Models → Benchmark** loads a model, runs a fixed short prompt, and records **load time,
first-token latency, tokens/sec, backend, GPU layers, estimated max context, and OOM
events**, then **restores your chat model**. History is stored in the `benchmarks` table;
**Best for this PC** ranks installed models by throughput + load time + backend.

## 5. Model Hub health & download reliability

- **True fit labels:** *fits fully on GPU* · *partial GPU offload* · *CPU only / slow* ·
  *not recommended* — from VRAM/RAM vs the model's weights.
- **DAWN nicknames** next to each catalog entry (real name preserved).
- **Downloads:** resumable (HTTP Range) with **pause / resume / retry / cancel**, real
  status/error, **size verification**, and a **SHA-256 computed + shown on completion**
  (compared against an expected hash when the catalog provides one).

## 6. Brain integration

Benchmarks create **Model nodes** (Tools region) — faster models glow brighter, compare
winners brighter still; failed/OOM runs add warning edges to the core. Comparisons create
**Compare nodes** (Logic region). Optimizer recommendations and benchmark metrics are
carried in node metadata, inspectable in the Brain Explorer.

## Files

```
electron/services/optimizer/   hardware detect · metadata + nicknames · compatibility · settings · storage · service
electron/services/bench/       benchCore (pure) · runner (shared engine) · compare · benchmark
electron/services/runtime.ts   buildArgs now emits -ub / --no-mmap / --mlock
src/components/ModelOptimizer.tsx · ModelManager.tsx · ModelHub.tsx
tests/optimizer.test.ts · tests/bench.test.ts   (npm run test:agentos)
```

IPC: `window.dawn.optimizer.*`, `window.dawn.bench.{run, history, best, delete}`.

## Vision role

The `vision` role (see `modelCookbookCore` ROLES) marks a vision-capable model used by **Vision Chat**
(image attachments). A vision model needs both a VLM GGUF and its `mmproj` projector; the Model Cookbook
surfaces the best installed vision model, and System Health → **Vision Chat** reports whether image chat
is ready or what setup is missing. See [VISION_CHAT.md](VISION_CHAT.md).
