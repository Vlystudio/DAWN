# 🧠 DAWN — Digital Autonomous Workspace Node

A **fully local** AI assistant with a **living, data-driven 3D brain**. DAWN runs
open-weight GGUF models through a **bundled llama.cpp runtime** (no Ollama, no
Docker, no LM Studio, no cloud) and makes the AI's "mind" visible: a holographic
neural core that reacts in real time, plus a **Brain Explorer** you can fly into.

Everything runs on your machine. No chat or files are sent to any cloud service.

> DAWN appears responsive and "alive" through animation, memory and status
> changes — but it is **not conscious or sentient**. It's a useful local system.

📚 **Docs:** [SETUP](docs/SETUP.md) · [MODELS](docs/MODELS.md) · [VOICE](docs/VOICE.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)

---

## ✅ What's implemented

- **Local inference runtime** — `DawnRuntimeManager` launches a bundled
  **llama.cpp `llama-server.exe`** bound to `127.0.0.1`, picks a free port,
  watches `/health`, captures stdout/stderr, detects CUDA/Vulkan/CPU, and stops
  gracefully (force-kill only as a fallback). States: OFF · STARTING ·
  LOADING_MODEL · READY · GENERATING · ERROR · STOPPING.
- **Native ON/OFF power switch** in the sidebar (start/stop the runtime).
- **Streaming chat** via the runtime's OpenAI-compatible `/v1/chat/completions`
  (Stop, Regenerate, markdown + code copy).
- **Model Hub** — browse a catalog of free/open-weight GGUF models (Qwen2.5 /
  Coder, DeepSeek, Gemma, Llama, GLM…), see what **fits your GPU**, and let DAWN
  **download** them (resumable, pause/resume/retry) into `models/<family>/`.
  Gated models show **“requires manual access.”** Plus **hardware detection**
  (VRAM/RAM/disk) and **task routing** (fast / coding / reasoning / embedding).
- **Model Manager** — installed GGUFs, import, select, remove, size + quant + RAM estimate.
- **First-run setup** — pick a model + performance mode + context + memory/knowledge.
- **Local memory** — view/add/edit/delete/pin, confirmed saves; recalled memories light the brain and are cited.
- **Local Knowledge / RAG** — index folders you approve, on-device embeddings, retrieval + citations (safety-filtered).
- **Agentic tools** — **PowerShell** + **internet (search/fetch)** with an
  **approval gate** + audit log (off by default; SSRF-guarded web).
- **Voice (local TTS)** — speaks responses offline, streaming sentence-by-sentence,
  interrupt, presets ("Jarvis-inspired" British), read-aloud (Kokoro/Piper upgrade documented).
- **Data-driven 3D brain** — `brain_nodes`/`brain_edges` from your real data;
  docked in chat + a **Brain Explorer** with glowing neuron/galaxy nodes,
  per-node breathing, a starfield, and **hover + click** inspection.
- **In-place auto-updates** (electron-updater) — DAWN updates itself, no reinstall.
- **SQLite** for everything; **Blender** brain generator; **Logs** + **Settings**.

**Next phase (clearly staged):** PDF/DOCX parsing for RAG, semantic embeddings
via a dedicated GGUF embed model, model benchmarking (tok/s) + update checker in
Model Hub, and the Kokoro/Piper voice sidecar.

---

## 🧱 Stack & key decisions

| Choice | Why |
|---|---|
| **TypeScript everywhere** | Renderer via Vite/esbuild; main via `tsc → dist-electron` (CommonJS). |
| **Tailwind + hand-rolled shadcn-style `ui/`** | shadcn's look via Tailwind + `cva`, without the Radix/CLI weight. Full shadcn is a later pass. |
| **SQLite via `sql.js` (WASM)** | Real SQLite, **zero native build** (no node-gyp / Electron ABI / CDN fragility on Windows). Brute-force cosine for vectors at MVP scale. |
| **Brain procedural by default; GLB optional** | The runtime brain renders with **no asset required**. The Blender script generates `dawn_ai_brain.glb` for when you want the baked model — DAWN loads it if present, else stays procedural. |
| **Deterministic node positions** | Layout is hashed from node id, so the brain is stable across rebuilds but still clustered per region. |

---

## 🗂️ Project structure

```
dawn/
├── package.json            # scripts: build:main (tsc) + build (vite) + dist (electron-builder)
├── tsconfig.json           # renderer (esbuild transpiles; type-check is advisory)
├── tsconfig.main.json      # main/preload/services -> dist-electron (CommonJS)
├── vite.config.ts  tailwind.config.js  postcss.config.js  index.html
│
├── blender/
│   └── create_dawn_ai_brain.py     # procedural brain -> dawn_ai_brain.glb
│
├── electron/               # ── MAIN PROCESS (TypeScript) ──
│   ├── main.ts             # window, lifecycle, boot
│   ├── preload.ts          # secure window.dawn bridge
│   ├── ipc.ts              # all renderer-callable channels
│   └── services/
│       ├── db.ts           # sql.js + full DAWN schema (12 tables)
│       ├── ollama.ts       # streaming chat / models / embeddings
│       ├── chat.ts         # conversations + streaming generate + memory recall
│       ├── memory.ts       # memory CRUD + recall + context block
│       ├── graph.ts        # ★ builds brain_nodes/edges from real data
│       ├── settings.ts     # local JSON settings
│       └── logger.ts
│
└── src/                    # ── RENDERER (React + TS + Tailwind) ──
    ├── main.tsx  App.tsx  index.css  types.ts
    ├── lib/cn.ts
    ├── state/brainStore.ts             # zustand: brain state + graph + perf
    ├── ui/{button,card}.tsx            # shadcn-style primitives
    ├── components/
    │   ├── Sidebar.tsx  ChatView.tsx  Composer.tsx  Markdown.tsx
    │   ├── MemoryManager.tsx  SettingsView.tsx  LogsView.tsx
    └── brain/             # ── 3D BRAIN ──
        ├── BrainState.ts                # state machine + per-state visuals
        ├── BrainProvider.tsx            # wires real chat events -> brain state
        ├── AIBrainScene.tsx             # abstract docked brain (Canvas + overlay + fallback)
        ├── AIBrainCore.tsx  BrainParticles.tsx  BrainOrbitRings.tsx
        ├── BrainExplorer.tsx            # the inspectable graph view
        ├── NeuralNodeField.tsx          # instanced nodes from brain_nodes
        ├── NeuralConnections.tsx        # brain_edges as line segments
        ├── BrainCameraControls.tsx      # drei OrbitControls
        └── BrainNodeDetailsPanel.tsx    # click-a-node detail + actions
```

---

## ✅ Prerequisites

| Tool | Why | Get it |
|---|---|---|
| **Node.js 18+** | build/run | <https://nodejs.org> |
| **llama.cpp `llama-server.exe`** | local inference runtime | [releases](https://github.com/ggml-org/llama.cpp/releases) → `resources/runtime/` (CUDA build for the 4080) |
| A **GGUF** model | answers | Download in **Model Hub**, or import in **Model Manager** |
| (Optional) **Blender 4.x** | regenerate the brain GLB | <https://blender.org> |

> No Ollama / Docker / LM Studio / cloud required. See **[docs/SETUP.md](docs/SETUP.md)**.

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
npm run dist        # -> release/DAWN-Setup-0.1.0.exe
```

The installer is unsigned, so SmartScreen shows *"Windows protected your PC"* →
**More info → Run anyway** (code signing requires a paid certificate).

## 🎨 Regenerate the 3D brain (optional)

```powershell
blender --background --python blender/create_dawn_ai_brain.py
# writes public/models/dawn_ai_brain.glb
```

DAWN renders a procedural brain with **no** GLB required; the asset is for higher-fidelity baked geometry.

---

## 🧠 How the brain works (it's not decorative)

`electron/services/graph.ts` turns your real data into a graph:

- **Core** at the center → 7 **region anchors**: Conversations, Memories, Local
  Knowledge, Logic & Rules, Tools, Projects, Web Research.
- Each **conversation**, **memory**, **project**, **rule**, **tool** (and later
  file / web source) becomes a node placed in its region, edged to its anchor.
- The **3D brain** (chat dock) and **Brain Explorer** render this data. The
  Explorer lets you orbit, filter by region, search, click a node to see its
  details/connections, and pin/forget memories.

The **brain state machine** (`BrainState.ts` + `BrainProvider.tsx`) reacts to
real chat events: pressing send → **THINKING**, memory recall → **RETRIEVING_MEMORY**
(violet), token streaming → **RESPONDING**, errors → **ERROR**, idle → **IDLE**.
States: `OFF · BOOTING · IDLE · LISTENING · THINKING · RETRIEVING_MEMORY ·
READING_LOCAL_FILES · SEARCHING_WEB · INDEXING · RESPONDING · ERROR`.

When DAWN uses a memory, that memory's node is touched, the brain shifts to the
memory state, and the answer shows **"Used memory: …"**.

---

## 🔒 Privacy & safety

- 100% local: chat goes only to your Ollama at `localhost`. Nothing is uploaded.
- Memory saving is always explicit/confirmed. Memory can be disabled entirely.
- Protected rules (privacy, localhost-only, no whole-disk scan, skip secrets) are
  modeled as **protected** nodes in the Logic region and shown read-only.
- Future folder indexing is **opt-in per folder** and will hard-skip AppData,
  `node_modules`, `.git`, `.env`, SSH/API keys, password vaults and browser profiles.

---

## 🧯 Troubleshooting

| Symptom | Fix |
|---|---|
| Brain says **"Ollama is offline"** | Start Ollama (`ollama serve` or the app), then reopen DAWN. |
| **"No chat model selected"** | Pick a model in the composer dropdown, or `ollama pull llama3`. |
| 3D brain is a flat 2D core | WebGL unavailable or disabled — toggle **Settings → 3D brain**, or it auto-fell back. |
| Choppy animation | Enable **Low performance mode**, turn off **Particles**, or set an **FPS cap** in Settings. |
| Brain Explorer looks sparse | Fresh install — chat a bit and add memories, then **Rebuild graph**. Seed projects/rules/tools are always present. |
| `npm install` Electron download fails | `$env:NODE_OPTIONS="--use-system-ca"; npm install` |

Detailed activity is on the **Logs** page and in `%APPDATA%\dawn\logs\dawn.log`.
The database lives at `%APPDATA%\dawn\dawn.db`.

---

## 🔮 Roadmap (next phases)

1. **Local Knowledge / RAG** — folder indexing (opt-in), embeddings, file nodes light up + citations.
2. **Web Research** — SearXNG/Brave providers, source nodes around the brain, reliability scoring.
3. **Per-node activation** during chat — fire visible neural paths from used nodes to the core.
4. **Local AI Control Center** — Docker/Ollama/Open WebUI ON-OFF with the boot animation.
5. **GLB pipeline** — load `dawn_ai_brain.glb` with region-mapped sub-meshes; bloom/postprocessing.
6. **Voice & sound** — STT input, TTS output, subtle brain/thinking/response cues.
7. **Full shadcn/ui** component pass.

## 📜 License

MIT. Local-first. You own your data.
