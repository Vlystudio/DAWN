# DAWN Model Arena (Compare)

Run the same prompt across **2–4 installed models** and compare them head-to-head with
real metrics, optional blind judging, and an AI judge that picks a winner and synthesizes
a merged best answer. Open it from the left rail: **Compare** (⚔️). Clean-room,
DAWN-native (no Odysseus code).

## How it works

DAWN runs **one llama.cpp model at a time**, so Compare loads each selected model **in
turn** (sequential — chosen for stability), streams its answer, measures it, then moves
on. Your originally-loaded chat model is **always restored** at the end — Compare never
silently leaves a different model loaded.

> The run loop is abstracted behind a single-model executor (`runOne`) so a future
> parallel mode (multiple runtime instances) can be slotted in without changing callers.

## Using it

1. Type a prompt.
2. Tick **2 to 4** installed models (each gets a slot letter A/B/C/D).
3. Optionally enable **Blind mode** (models show as *Model A/B/C* until you **Reveal**).
4. **Run.** Watch the answers stream side-by-side. **Stop** cancels and restores your model.
5. **Judge / Synthesize** → a judge model (the loaded one, or one you pick) compares the
   outputs and returns a **winner**, per-model **strengths/weaknesses**, and a **merged
   best answer**. In blind mode the judge sees only A/B/C.

Every comparison is saved to local history (left rail) and reopens with outputs, metrics,
and the verdict.

## Metrics (per model)

- **First-token latency** and **total generation time**
- **Tokens/sec** (completion tokens ÷ generation time)
- **Prompt / completion tokens** (accurate via the server `/tokenize`, estimated if
  unavailable)
- **Load time** (model hot-swap → ready)
- **Backend** (CUDA / Vulkan / CPU) and **GPU layers** (ngl)
- **Context length**, **temperature / top-p / repeat-penalty**
- **Peak RAM estimate** (from the model's footprint)
- **OOM / load-failure** is captured and shown per model — a failed model doesn't abort
  the comparison.

## Data model

- `compare_runs` — prompt, params, blind flag, judge model, winner, status, timestamps.
- `compare_outputs` — one row per model: exact **model path + quant + settings**, the
  output, and **all metrics** above (+ `status`, `error`, `oom`).
- `compare_scores` — the judge verdict: winner, strengths/weaknesses (JSON), reasoning,
  merged answer.

## Safety

- Candidate answers are **untrusted**: the judge prompt wraps every answer with DAWN's
  prompt-injection firewall (`<<UNTRUSTED …>>` + the standing rule), so a model that emits
  "ignore previous instructions" can't hijack the judge.
- Compare/judge **save and restore** the user's chat model around model switches.

## Brain integration

`graph.rebuild()` turns each comparison into a **Compare node** (Logic region) and each
benchmarked model into a **Model node** (Tools region). The **winning** model's node
brightens (and links from the Compare node via a `winner` edge); failed/OOM benchmarks add
an `oom_warning` / `error_warning` edge to the core.

## Files

```
electron/services/bench/benchCore.ts   pure: tokens/sec, blind labels, judge prompt/parse, ranking  ← tested
electron/services/bench/runner.ts      shared engine: load-swap a model, stream, time, count tokens, detect OOM
electron/services/bench/compare.ts     CompareService (sequential, restore, judge, persistence)
src/components/CompareView.tsx          the Compare tab UI
docs/COMPARE.md (this file) · tests/bench.test.ts
```

IPC: `window.dawn.compare.{start, cancel, judge, list, get, delete, onProgress}`.

## Acceptance check

Install Qwen 7B and Qwen 14B (Model Hub), open **Compare**, pick both, enter a prompt, and
**Run** → side-by-side outputs with tokens/sec and load time. Toggle **Blind mode** and use
**Reveal**. **Judge** to get a winner + merged answer.
