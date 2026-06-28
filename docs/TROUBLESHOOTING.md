# DAWN — Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Power switch says **“Runtime not installed”** | `llama-server.exe` missing | Put it in `resources/runtime/` (see SETUP) or set the path in **Settings → Local runtime**. |
| **“No model — import one in Model Manager”** | No GGUF selected | Download one in **Model Hub**, or **Model Manager → Import GGUF**. |
| Runtime goes to **ERROR** right after starting | Model too big / wrong GPU build / bad file | Check **Logs** (llama.cpp stdout). Try a smaller quant, lower **GPU layers (-ngl)**, or a CPU build. |
| Stuck on **LOADING_MODEL** | Large model still loading, or GPU OOM | Wait (72B is slow); or reduce `-ngl` / context length; try Q4. |
| Backend shows **CPU** but you have a 4080 | CPU-only `llama-server.exe` | Download a **CUDA** build of llama.cpp. |
| Chat: **“runtime is not ready”** | DAWN is off | Press the power switch and wait for **READY**. |
| **Port conflict** | Configured port busy | DAWN auto-picks the next free port (see Logs); or change it in Settings. |
| Model **download fails / stalls** | Network or HF hiccup | Use **pause → resume** (resumable). Errors show in the Downloads panel. Gated repos show “requires manual access”. |
| Brain Explorer is a flat 2D core | WebGL unavailable / disabled | **Settings → AI Brain → 3D brain**; it auto-falls back to 2D otherwise. |
| Choppy 3D | Weak GPU | Enable **Low performance mode**, turn off **Particles**, set an **FPS cap**. |
| **Voice** doesn't speak | Disabled, or no OS voice | Enable in Settings → Voice; install a UK English voice in Windows (see VOICE.md). |
| Voice reads code aloud | Setting off | Settings → Voice → **Don't speak code blocks** (on by default). |
| **PowerShell/Web tool** never runs | Tools off, or you denied it | Enable in **Settings → Tools** (and the chat **Tools** chip). PowerShell needs your **Approve**. |
| **Auto-update** never finds anything | No feed configured | Set `build.publish` and publish `latest.yml` + the `.exe` (see SETUP). |
| `npm install` Electron download fails | Corporate proxy / self-signed cert | `$env:NODE_OPTIONS="--use-system-ca"; npm install` |

**Logs:** the in-app **Logs** page mirrors runtime startup, model loading,
llama.cpp stdout/stderr, chat, RAG, downloads, tool runs, and errors. File copy:
`%APPDATA%\DAWN\logs\dawn.log`.

**Recovery:** if the database ever won't open, DAWN starts a fresh one and logs
it; the old file remains at `%APPDATA%\DAWN\dawn.db` for inspection.
