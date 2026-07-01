# 🧠 DAWN — Digital Autonomous Workspace Node

A **fully local** AI assistant with a **living, data-driven 3D brain**. DAWN runs
open-weight GGUF models through a **bundled llama.cpp runtime** (no cloud, no
Docker, no LM Studio) and makes the AI's "mind" visible: a holographic neural core
that reacts in real time, plus a **Brain Explorer** you can fly into.

Everything runs on your machine. No chat, files, or images are sent to any cloud service.

> **Private/internal build.** DAWN is a local-first app I build and run for my own use — not a public
> product, hosted service, or distributed release. There's no account, no telemetry, and no inbound
> network surface. Setup/build instructions below are for running it locally.

> DAWN appears responsive and "alive" through animation, memory and status
> changes — but it is **not conscious or sentient**. It's a useful local system.

📚 **Docs:** [SETUP](docs/SETUP.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [MODELS](docs/MODELS.md) · [MODEL_OPTIMIZER](docs/MODEL_OPTIMIZER.md) · [COMPARE](docs/COMPARE.md) · [RESEARCH](docs/RESEARCH.md) · [LOCAL_KNOWLEDGE](docs/LOCAL_KNOWLEDGE.md) · [ANSWER_VERIFICATION](docs/ANSWER_VERIFICATION.md) · [EVALS](docs/EVALS.md) · [VISION_CHAT](docs/VISION_CHAT.md) · [WORKSPACE](docs/WORKSPACE.md) · [WORKSPACE_GRAPH](docs/WORKSPACE_GRAPH.md) · [SKILLS](docs/SKILLS.md) · [SECURITY](docs/SECURITY.md) · [EMAIL](docs/EMAIL.md) · [BACKUP_RESTORE](docs/BACKUP_RESTORE.md) · [VOICE](docs/VOICE.md) · [UI_SYSTEM](docs/UI_SYSTEM.md) · [SYSTEM_HEALTH](docs/SYSTEM_HEALTH.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)

---

## ✅ What's implemented

### Core
- **Local inference runtime** — `DawnRuntimeManager` launches a bundled
  **llama.cpp `llama-server.exe`** bound to `127.0.0.1`, picks a free port,
  watches `/health`, captures stdout/stderr, detects CUDA/Vulkan/CPU, and stops
  gracefully. States: OFF · STARTING · LOADING_MODEL · READY · GENERATING · ERROR · STOPPING.
- **Native ON/OFF power switch** in the sidebar (start/stop the runtime).
- **Streaming chat** via the runtime's OpenAI-compatible `/v1/chat/completions`
  (Stop, Regenerate, markdown + code copy). No cloud.
- **Model Hub** — browse a catalog of free/open-weight GGUF models (Qwen2.5 /
  Coder, DeepSeek, Gemma, Llama, GLM…), see what **fits your GPU**, and let DAWN
  **download** them (resumable) into `models/<family>/`. Plus **hardware detection**
  (VRAM/RAM/disk) and **role routing** (fast / coding / reasoning / embeddings / vision / reranker).
- **Model Manager / Optimizer / Cookbook / Compare / Benchmark** — installed GGUFs
  (import/select/remove), hardware-aware per-model settings, "best model per role +
  honest hardware fit", 2–4 model head-to-head with an AI judge, and "Best for this PC" tok/s.
- **Local memory** — view/add/edit/delete/pin, confirmed saves; recalled memories light the brain and are cited.

### Local Knowledge / retrieval (SOTA-for-local, measurable + honest)
- **Hybrid retrieval** — **vector** (on-device embeddings) + real **BM25 keyword**, fused with
  reciprocal-rank fusion; honest mode per query (hybrid / vector / keyword / unavailable).
- **Chunking v2** — heading/title-aware Markdown sections (section path + parent heading),
  code-block-preserving, real line numbers; a **reindex** upgrades old indexes.
- **Query rewrite + HyDE** (optional, local model) widen recall; **reranker** (embedding-similarity,
  honest heuristic/cross-encoder fallback) reorders candidates — all degrade honestly.
- **Answer verification** — every RAG answer is checked claim-by-claim against the retrieved sources
  (supported / partial / unsupported / not-enough-evidence), optionally upgraded by **local-model
  entailment**. Never fabricates support.
- **RAG eval harness** — `npm run eval:rag` + an **in-app** run: deterministic, offline metrics
  (hit-rate, groundedness, negatives-leaked) + a retrieval-strategy comparison.
- **Knowledge safety** — opt-in folders only; never indexes `.env`/keys/credentials/vault/browser
  profiles/`node_modules`/`.git`; stale/removed detection; honest citations (never faked pages).

### Vision Chat / image attachments
- **Paste, drag-drop, or upload images** into chat (PNG/JPEG/WebP/GIF), previewed and stored locally.
- If a **vision-capable local model** (VLM GGUF + mmproj) is configured, DAWN analyzes the image
  on-device via the bundled `llama-mtmd-cli`; otherwise it **honestly says it can't see it** (never
  guesses). Model setup + auto-detect + on-device test live in the **Model Cookbook**.

### Workspace & platform
- **Home / Dashboard**, **Deep Research** (plan → cited report; web off by default),
  **Documents / Notes / Tasks / Calendar**, **Email** (local IMAP/SMTP; send only after approval),
  **Coding Autopilot** (scoped, approval-gated edits), integrations (**Obsidian**, **Notion**),
  **Voice (local TTS)**, and **Live Vision** (webcam perception, off by default).
- **Workspace Graph** — typed, linkable items across features (notes/tasks/docs/research/…), searched
  and shown in the Brain; real features auto-register (live hooks + reconcile).
- **Skills + Tool Registry** — every capability is a typed tool with risk/permission/approval + audit;
  user Skills are scoped to allowed tools.
- **PromptSecurity** — a central firewall: untrusted content (RAG/web/notes/docs/email/tool/image text)
  is wrapped as evidence and can **never** become system instructions.
- **Security / Vault / Auth / 2FA** — optional Secure mode (scrypt password, TOTP + backup codes, app
  lock), an **AES-256-GCM Vault**.
- **Backup / Restore** — verified `.dawnbackup` archives, encrypted vault included, pre-restore safety
  snapshot + rollback, critical-approval restore.
- **System Health** — an honest, live feature-completion map (status / works / missing / next step per
  area) with a redacted **diagnostics export**.
- **Design system** — layout-safe page shells (panel / split / log / canvas) rolled out screen-by-screen
  with a tracked migration checklist + one central status-language source.
- **Command palette** (`Ctrl/Cmd+K`) and **Global search** (`Ctrl/Cmd+Shift+F`) — the vault is never searched.
- **Data-driven 3D brain** — `brain_nodes`/`brain_edges` from your real data, docked in chat + a
  **Brain Explorer** with hover + click inspection.

**Privacy & security principles:** local-first (no cloud, no telemetry); secrets are never stored in
plaintext, never logged, never put into model prompts, never in backups or the brain graph; risky tools
require explicit approval; retrieved/image text is untrusted; everything is auditable. See
[SECURITY](docs/SECURITY.md) and [ARCHITECTURE](docs/ARCHITECTURE.md).

**Build & test:** `npm run build` (main `tsc` + Vite renderer) · `npm run test:agentos` (**379** tests) ·
`npm run eval:rag` (offline RAG eval).

---

## 🧱 Stack & key decisions

| Choice | Why |
|---|---|
| **TypeScript everywhere** | Renderer via Vite/esbuild; main via `tsc → dist-electron` (CommonJS). |
| **Bundled llama.cpp** | `llama-server.exe` for chat + `llama-mtmd-cli.exe` for vision — no Ollama/Docker/LM Studio needed. Local embeddings can optionally use Ollama's `nomic-embed-text`, else a real keyword fallback. |
| **Pure-core pattern** | Business logic lives in electron-free `*Core.ts` modules unit-tested in `node:test` (retrieval, chunking, verification, evals, security, workspace, …). |
| **SQLite via `sql.js` (WASM)** | Real SQLite, **zero native build** (no node-gyp / Electron ABI fragility on Windows). |
| **Brain procedural by default; GLB optional** | The runtime brain renders with **no asset required**; a Blender script bakes `dawn_ai_brain.glb` if you want it. |

---

## 🗂️ Project structure (representative)

```
dawn/
├── package.json            # build:main (tsc) + build (vite) + dist (electron-builder) + eval:rag
├── tsconfig.main.json      # main/preload/services -> dist-electron (CommonJS)
├── tsconfig.test.json      # pure *Core.ts + tests -> dist-test (node:test)
├── electron/               # ── MAIN PROCESS (TypeScript) ──
│   ├── main.ts  preload.ts (secure window.dawn bridge)  ipc.ts
│   └── services/
│       ├── db.ts  chat.ts  rag.ts  memory.ts  graph.ts  settings.ts  runtime.ts  llama.ts
│       ├── rag/            # hybridRetrieval / answerVerification / reranker / queryExpansion / entailment / ragEval
│       ├── knowledge/      # chunkingCore (v2) / knowledgeGuard / knowledgeStale / sourceState
│       ├── vision/         # visionChat (+ core) — image analysis via llama-mtmd-cli
│       ├── attachments/    # chat image attachments (storage + safe metadata)
│       ├── workspace/      # items / links / adapters / registry / liveHooks
│       ├── security/       # promptSecurity / auth / vault / crypto
│       ├── tools/  email/  backup/  research/  bench/  optimizer/  coding/  documents/  calendar/
│       └── featureMaturityCore.ts   # honest System Health
└── src/                    # ── RENDERER (React + TS + Tailwind) ──
    ├── App.tsx  components/  ui/ (design-system shells)  lib/statusMap.ts
    └── brain/              # 3D brain (state machine + explorer + node details)
```

---

## ✅ Prerequisites

| Tool | Why | Get it |
|---|---|---|
| **Node.js 18+** | build/run | <https://nodejs.org> |
| **llama.cpp binaries** | local inference (`llama-server.exe`) + vision (`llama-mtmd-cli.exe`) | [releases](https://github.com/ggml-org/llama.cpp/releases) → `resources/runtime/` |
| A **GGUF** model | answers | Download in **Model Hub**, or import in **Model Manager** |
| (Optional) **Ollama** | on-device embeddings (`nomic-embed-text`) for Local Knowledge | <https://ollama.com> — else DAWN uses a keyword fallback |
| (Optional) a **VLM + mmproj** | Vision Chat image analysis | Model Hub → configure in **Model Cookbook** |
| (Optional) **Blender 4.x** | regenerate the brain GLB | <https://blender.org> |

> No cloud required. See **[docs/SETUP.md](docs/SETUP.md)**.

---

## 🚀 Install & run (Windows)

```powershell
cd dawn
npm install
npm run build      # tsc (main) + vite (renderer)
npm start          # launch DAWN

# or live-reload development:
npm run dev
```

> If `npm install` fails downloading Electron behind a corporate proxy/cert,
> run it once as: `$env:NODE_OPTIONS="--use-system-ca"; npm install`

## 📦 Build a Windows installer (.exe)

```powershell
npm run dist        # -> release/DAWN-Setup-<version>.exe  (e.g. 0.2.0-beta.22)
```

The installer is unsigned, so SmartScreen shows *"Windows protected your PC"* →
**More info → Run anyway** (code signing requires a paid certificate).

## 🧪 Tests & eval

```powershell
npm run test:agentos   # 379 pure-core tests (node:test)
npm run eval:rag       # deterministic offline RAG eval (hit-rate / groundedness / strategy comparison)
```

`npm run lint`, `npm test`, and `npm run smoke` do **not** exist in this project.

---

## 🧠 How the brain works (it's not decorative)

`electron/services/graph.ts` turns your real data into a graph: a **Core** at the center → region
anchors (Conversations, Memories, Local Knowledge, Logic & Rules, Tools, Projects, Web Research). Each
conversation, memory, note/task/document, tool, and workspace item becomes a node edged to its anchor.
The **3D brain** (chat dock) and **Brain Explorer** render this data — orbit, filter, search, click a
node for details/connections, pin/forget memories.

The **brain state machine** reacts to real chat events: send → **THINKING**, memory recall →
**RETRIEVING_MEMORY**, local files → **READING_LOCAL_FILES**, image analysis → **LOOKING**, streaming →
**RESPONDING**, errors → **ERROR**, idle → **IDLE**.

---

## 🔒 Privacy & safety

- **100% local by default** — chat runs on the bundled llama.cpp at `127.0.0.1`; image analysis runs
  on-device; nothing is uploaded. Web tools are **off by default** and SSRF-guarded when enabled.
- Memory saving is always explicit/confirmed and can be disabled.
- **Local Knowledge is opt-in per folder** and hard-skips AppData, `node_modules`, `.git`, `.env`,
  SSH/API keys, password vaults, and browser profiles.
- **Untrusted-by-default** — retrieved documents/web/email and image OCR/vision text are wrapped as
  evidence and can never become instructions or trigger tools.
- Secrets live in an encrypted vault, are never logged, never enter prompts/diagnostics/backups/graph.

---

## 🧯 Troubleshooting

| Symptom | Fix |
|---|---|
| **"DAWN runtime is not ready"** | Turn DAWN **ON** (sidebar power switch) and wait for the model to load; pick a model in the composer if none is selected. |
| **No models to pick** | Install one in **Model Hub**, or import a `.gguf` in **Model Manager**. |
| **Local Knowledge shows "keyword fallback"** | No embedding model — install/enable Ollama `nomic-embed-text` for hybrid vector search (keyword works without it). |
| **"This model cannot see images"** | No vision model configured — set up a VLM + mmproj in **Model Cookbook → Vision Chat model**. |
| 3D brain is a flat 2D core | WebGL unavailable — toggle **Settings → 3D brain**, or it auto-fell back. |
| Choppy animation | Enable **Low performance mode**, turn off **Particles**, or set an **FPS cap** in Settings. |
| `npm install` Electron download fails | `$env:NODE_OPTIONS="--use-system-ca"; npm install` |

Detailed activity is on the **Logs** page and in `%APPDATA%\DAWN\logs`. The database lives at
`%APPDATA%\DAWN\dawn.db`. **System Health** shows an honest, live status for every feature area.

---

## 🔮 Roadmap (honest next steps)

1. **Dedicated helper runtime** — a second small `llama-server` so retrieval helpers (rewrite/HyDE/
   entailment) don't contend with the chat model.
2. **Real cross-encoder reranker** (GGUF via `llama-server --reranking`, or a bundled ONNX provider).
3. **Live-index strategy eval** — run the retrieval-strategy comparison over the user's real index.
4. **Vision** — exercise end-to-end analysis with an installed VLM; add OCR-on-upload fallback.
5. Continue the **design-system** rollout (split screens) after visual verification.

## 📜 License

MIT. Local-first. You own your data.
