# DAWN — Setup (Windows 11)

DAWN runs **entirely locally**: a bundled llama.cpp runtime serves your GGUF
models over `127.0.0.1`. No Ollama, no Docker, no LM Studio, no cloud.

## 1. Build / run from source

```powershell
cd dawn
npm install                 # if Electron download is blocked by a corp cert:
                            #   $env:NODE_OPTIONS="--use-system-ca"; npm install
npm run build               # tsc (main) + vite (renderer)
npm start                   # launch
# dev (live reload): npm run dev
```

## 2. Add the llama.cpp runtime (`llama-server.exe`)

DAWN needs llama.cpp's server binary. It is **not** committed (large, GPU-specific).

1. Download a Windows build: <https://github.com/ggml-org/llama.cpp/releases>
   - RTX 4080 Super → a **CUDA** build (`*-cuda-*`) for full GPU acceleration.
   - No NVIDIA GPU → a **CPU** or **Vulkan** build.
2. Copy `llama-server.exe` (and any DLLs it ships with) into:
   ```
   resources/runtime/llama-server.exe
   ```
   Or point DAWN at an existing one via **Settings → Local runtime → Runtime executable path**.

When packaged, this folder is bundled as `resources/runtime` (electron-builder `extraResources`).

## 3. Get a model — two ways

- **Model Hub (recommended):** open **Model Hub** in DAWN, pick a model, click
  **Download**. DAWN downloads the GGUF directly into `%APPDATA%\DAWN\models\<family>\`.
  Resumable; nothing is downloaded until you choose.
- **Import:** **Model Manager → Import GGUF** to copy a `.gguf` you already have.

Gated models (manual license acceptance) appear as **“requires manual access”** with a link.

## 4. Turn DAWN on

Press the **power switch** (top of the sidebar). DAWN:
1. launches `llama-server.exe` bound to `127.0.0.1` (auto-picks a free port),
2. loads the selected GGUF (brain shows **BOOTING → LOADING_MODEL → READY**),
3. chat now streams from the local runtime.

## 5. Build a Windows installer (.exe) with in-place updates

```powershell
npm run dist                # -> release/DAWN-Setup-<version>.exe (NSIS, installed app)
```

For **auto-update**, set `build.publish` in `package.json` to your feed (the
default is a `generic` placeholder URL) and publish each release's `*.exe` +
`latest.yml` there. DAWN then updates **in place** — no reinstall — preserving
your chats, memory, knowledge and models (all in `%APPDATA%\DAWN`).

## Data locations
- Database (chats/memory/brain/knowledge): `%APPDATA%\DAWN\dawn.db`
- Models: `%APPDATA%\DAWN\models\` · Logs: `%APPDATA%\DAWN\logs\`
- Settings: `%APPDATA%\DAWN\settings.json`
