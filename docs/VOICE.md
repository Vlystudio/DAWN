# DAWN — Voice (local TTS)

DAWN speaks responses **out loud, fully offline**. The voice profile is an
*original* "sophisticated British AI assistant" feel — calm, medium-low pitch,
clear cadence. It does **not** clone Jarvis / Paul Bettany or any real voice.

## Default engine: Piper (neural — bundled)

DAWN ships a local **Piper** neural TTS in `resources/piper/` with two voices:

- **`en_GB-alan-medium`** — calm British male (the default "Jarvis-esque" voice)
- **`en_US-ryan-high`** — higher-fidelity male (American accent)

This sounds **far more human** than Windows voices, runs at ~18× real-time on
CPU, and is fully offline. Per-sentence WAVs are synthesized in the main process,
cached (`%APPDATA%\DAWN\voice-cache`), and streamed as DAWN generates. Choose the
engine and voice in **Settings → Voice** (Engine = *Auto* uses Piper when present).

**Add more Piper voices:** drop `<name>.onnx` + `<name>.onnx.json` into
`resources/piper/voices/` (from <https://huggingface.co/rhasspy/piper-voices>),
then pick it in Settings → Voice. British options include `en_GB-alan`,
`en_GB-northern_english_male`, `en_GB-alba` (female), `en_GB-cori` (female).

## Fallback engine: Windows / Web Speech

If Piper isn't present (or Engine = *Windows voices*), DAWN uses the OS speech
voices via the Web Speech API. Enable in **Settings → Voice** (or the speaker
button in chat):

- **Streaming speech** — speaks sentence-by-sentence as the model generates.
- **Interrupt** — the ◼ button (or muting) stops instantly.
- **Skips code blocks / tables** by default.
- **Rate / pitch / volume** sliders + presets (Jarvis-inspired, Calm, Fast).
- **Read aloud** on any message; **Startup greeting** toggle.

**Recommended config (British AI):** install a UK English voice in Windows
(*Settings → Time & language → Speech → Manage voices → Add* → "English (United
Kingdom)"), then pick it in **Settings → Voice → Voice (Windows)**. Preset:
**Jarvis-inspired**, Rate ~0.98, Pitch ~0.9.

## High-quality engines (optional upgrade): Kokoro / Piper

For a richer, more natural voice, plug in a local neural TTS. DAWN's
`voiceManager` exposes one interface (`speak / feed / stop`); a higher-quality
engine just needs to return audio that DAWN plays. Recommended:

### Piper (fast, tiny, great quality)
```powershell
# one-time, local:
pip install piper-tts
# download a British male voice (e.g. en_GB-alan-medium) from:
#   https://github.com/rhasspy/piper/releases  (voices)
# then synthesize:
echo "Hello, I am DAWN." | piper -m en_GB-alan-medium.onnx -f out.wav
```

### Kokoro (very natural)
```powershell
pip install kokoro soundfile
# see https://github.com/hexgrad/kokoro for model + usage
```

**Integration:** add a small Python sidecar (`voice/engines/piper/server.py`)
that accepts text and returns a WAV path/stream; spawn it from a main-process
service and play the audio in the renderer via an `<audio>` element. The queue,
sentence-chunking, caching (hash of text + preset), and cancellation in
`src/voice/voiceManager.ts` stay the same — only the audio source changes.
This keeps Kokoro/Piper optional and the app working without them.

> Caching: for neural engines, cache WAVs keyed by `sha256(text + preset +
> rate + pitch + voice)` under `%APPDATA%\DAWN\voice-cache\`.
