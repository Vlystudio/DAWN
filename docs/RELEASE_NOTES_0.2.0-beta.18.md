# DAWN — 0.2.0-beta.18 — Internal Local Build

> Internal local build for my own use. **Not for public distribution.**

## What's new since beta.17

**Vision Chat / Image Attachments — paste, drop, or upload screenshots into chat.** Real end-to-end,
local-first, and honest about vision.

### You can now
- **Paste** a screenshot (Ctrl+V), **drag & drop** an image onto the composer, or **upload** via the
  paperclip. A thumbnail preview appears; remove it with the × before sending; click to open a larger
  preview. Send an image with or without text.
- Sent messages show the image thumbnail + an analysis status (attached / analyzing / analyzed / failed
  / vision unavailable).

### It's real, not a UI stub
- Images are validated (type sniffed from bytes, size + dimension limits, corrupt/renamed files rejected
  with plain-English errors) and stored locally in `%APPDATA%/DAWN/chat-attachments/` as
  content-addressed files (identical images stored once). Metadata persists in a new `chat_attachments`
  SQLite table and associates with the message.
- If a **vision-capable local model** is configured (a VLM GGUF + its `mmproj`), DAWN runs the **bundled
  multimodal runtime** (`llama-mtmd-cli`) on the image on-device and feeds the description into your chat
  model. `vision:capabilities` reports readiness honestly.
- If **no vision model** is configured (the default), DAWN still attaches/sends the image but **plainly
  says it cannot see it and never guesses** the contents. System Health → **Vision Chat** shows exactly
  what's missing and links to the Model Hub. OCR-on-upload fallback is reported honestly as not-yet-wired.

### Security & privacy (enforced + tested)
- **No cloud upload, no telemetry, no external API.** Analysis is on-device.
- Only **safe metadata** (name/mime/size/dimensions/id/date) ever leaves main — never the file path,
  bytes, content hash, EXIF, or OCR/vision text. Image content never enters logs, diagnostics, Global
  Search, or workspace metadata.
- Image text (OCR/vision) is treated as **UNTRUSTED** — wrapped + inspected by the prompt-injection
  firewall, described/quoted only, **never obeyed** and never a system message.
- Nothing is analyzed until you send the message.

## Under the hood
- New pure, unit-tested cores: `attachments/attachmentsCore.ts` (type/size/dimension validation via
  byte-sniffing, safe names, dedup keys, safe-metadata projection) and `vision/visionChatCore.ts`
  (honest capability resolution, mtmd-CLI arg building, output cleanup, honest "unavailable" text).
- New services: `attachments/attachments.ts` (storage + DB + preview), `vision/visionChat.ts`
  (capability detection + real `llama-mtmd-cli` inference, heavily guarded — a missing model/spawn
  error/timeout is an honest failure, never a fake answer).
- IPC: `chat:attachments:{addFromClipboard,addFromFile,removeDraft,listDraft,listForMessage,getPreview,
  getMetadata}` + `vision:capabilities`; `chat:send` now carries `attachmentIds`. Preload:
  `window.dawn.chatAttachments.*`.
- DB: `chat_attachments` table + `messages.has_images/attachment_count`. Settings:
  `maxImageAttachmentMB` (10), `maxImageDimensionPx` (4096), `maxImagesPerMessage` (4).
- System Health: new **Vision Chat / Image Attachments** area (honest — COMPLETE only with a vision
  model, else BLOCKED_BY_SETUP with the exact missing piece).

## Status
- Tests: **352 / 352 pass** (`npm run test:agentos`) — +14 for the attachment + vision cores (accepts
  PNG/JPG, rejects unsupported/oversized/corrupt, safe names, safe-metadata projection, honest
  capability logic, and OCR prompt-injection wrapping).
- Build: **green** (renderer compiled — validates Composer/ChatView/ChatAttachments). TypeScript (main):
  clean.
- Package: `npm run dist` → `release/DAWN-Setup-0.2.0-beta.18.exe` (unsigned).
- **Do not exist** (not run, not faked): `npm run lint`, `npm test`, `npm run smoke`. Renderer
  `typecheck` has pre-existing `SharedArrayBuffer` lib noise unrelated to this work; the build is
  authoritative.

## Honest gaps
- Full image understanding requires you to install a vision model + mmproj (none ships by default) — the
  default experience is the honest "vision unavailable / needs setup" path.
- OCR-only fallback for uploaded images is not wired yet (Live Vision OCR is webcam-frame only); reported
  honestly.

## Install
Overwrite-install over beta.17. All earlier fixes carry forward. Supersedes earlier betas. See
[VISION_CHAT.md](VISION_CHAT.md).
