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
| **Model too slow** | Big model / CPU / wrong settings | Open **Optimizer**, apply the recommended preset (or **Low VRAM**); **Benchmark** to compare tok/s; pick a smaller quant. |
| **Email sync failed** | Wrong host/port/TLS, or auth rejected | Use **Test connection** in account settings; errors are redacted. Most providers need an **App Password**. |
| **"App password needed"** (Gmail/Outlook/iCloud/Yahoo) | Provider blocks normal passwords | Create an **app-specific password** (enable 2FA first). DAWN does not implement OAuth. |
| **Vault locked** / "DAWN is locked" | Secure mode + session expired | Unlock with your admin password (+ 2FA). Vault reveal needs an active session. |
| **Lost admin password** | — | Secrets wrapped by the password are **unrecoverable**. On the **same machine** the OS-keychain wrap still works; cross-machine needs the password. Keep backup codes + a backup. |
| **TOTP / backup codes** | Lost authenticator | Use a **backup code** (each works once) to unlock, then regenerate codes or disable 2FA (needs password). |
| **Backup verify failed** | Corrupt/edited archive or newer version | Re-create the backup. A checksum mismatch or a newer schema version blocks restore on purpose. |
| **Restore failed** | Bad archive / mid-swap error | DAWN auto-rolls back from the **pre-restore safety snapshot**. Verify + restore the `pre-restore-….dawnbackup` in your backups folder. |
| **Research source fetch failed** | Site blocked / offline / SSRF guard | Web research is **off by default** (Settings → Research). Failed sources are skipped; the run continues. |
| **Graph slow / laggy** | Too many nodes | **Settings → AI Brain**: enable Low performance mode, reduce node limit, turn off particles. |
| **Approval modal denied** a tool | You clicked Deny (or it timed out) | Re-run and **Allow once**. High/critical tools always ask; this is by design. |
| **Build failed** | Stale deps / types | `rm -rf node_modules && npm install`, then `npm run build`. Run `npm run test:agentos` for details. |
| **Missing dependencies** at runtime | Partial install | `npm install` (bundled deps: sql.js, imapflow, nodemailer, mailparser, adm-zip). |
| **Windows Defender / SmartScreen** warns on the installer | Unsigned build | "More info → Run anyway". Sign the build for production. DAWN is local-only; nothing phones home. |

**Logs:** the in-app **Logs** page mirrors runtime startup, model loading,
llama.cpp stdout/stderr, chat, RAG, downloads, tool runs, and errors. File copy:
`%APPDATA%\DAWN\logs\dawn.log`.

**Recovery:** if the database ever won't open, DAWN starts a fresh one and logs
it; the old file remains at `%APPDATA%\DAWN\dawn.db` for inspection.
