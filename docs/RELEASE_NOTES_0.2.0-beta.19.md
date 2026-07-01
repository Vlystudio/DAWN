# DAWN — 0.2.0-beta.19 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.18

**Vision Chat setup — configure a local vision model in a few clicks, and verify it actually works.**
beta.18 shipped the image-attachment pipeline; beta.19 makes the vision model easy to set up and
honestly verifiable.

- **Model Cookbook → "Vision Chat model" panel** — granular, honest status: *Not configured · Model
  selected, mmproj missing · mmproj selected, model missing · File missing · Invalid (not .gguf) ·
  Runtime missing · **Ready***. File pickers for the VLM `.gguf` and its `mmproj`. **Full paths never
  cross the bridge — only file names are shown.**
- **Auto-detect** — scans **only DAWN's model folder** (never your disk), pairs a vision-named GGUF with
  an `mmproj` by folder proximity + name overlap, ranks candidates by confidence, and marks one
  high-confidence pair "recommended". **Nothing is applied without your confirmation + a re-validation.**
- **Test Vision Model** — runs the real bundled `llama-mtmd-cli` on a tiny test image and shows the
  actual sanitized result (or an honest error/timeout). Never fabricated.
- **Workspace image metadata** — a conversation with images now carries **safe** flags in its
  workspace-item metadata (`has_image_attachment`, `attachment_type: image`, `attachment_count`) —
  counts only, never a path/hash/filename/EXIF/OCR. Computed by the pure `withImageMeta`, recomputed
  each reconcile so it survives Brain rebuilds.
- **Visual verification checklist** added to `docs/VISION_CHAT.md` (16 items).

## Honest scope
- **No VLM ships by default**, so out of the box the panel shows the honest "not configured" state and
  chat still says it can't see images. Install a VLM + mmproj (Model Hub) and the panel walks you to
  **Ready**.
- **OCR-on-upload is still not wired** — the only OCR path is the webcam Live Vision sidecar, which
  can't read arbitrary files without a sidecar/venv change. `vision:capabilities` reports `ocr:false`
  and DAWN never fabricates OCR. Documented, not faked.

## Status
- Tests: **358 / 358 pass** (`npm run test:agentos`) — +6 (granular setup validation incl.
  basename-only output, VLM/mmproj auto-detect pairing incl. "plain text model not flagged", safe
  workspace image-metadata merge).
- Build: **green** (renderer compiled — validates VisionSetupPanel + Model Cookbook). TypeScript
  (main): clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.19.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to this work; the build is
  authoritative.

## IPC added (all sanitized)
`vision:{validate, autoDetect, applyPair, pickModel, clearSetup, testModel}`; preload
`window.dawn.vision.*` setup methods. No full paths returned to the renderer.

## Install
Overwrite-install over beta.18. All earlier fixes carry forward. See [VISION_CHAT.md](VISION_CHAT.md).
