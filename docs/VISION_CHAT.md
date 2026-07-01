# DAWN — Vision Chat / Image Attachments

Attach screenshots and photos to a chat message. DAWN stores them locally, shows a preview, and — if a
vision-capable local model is configured — actually analyzes them on your machine. Everything is
local-first: **no cloud upload, no telemetry, no external API.**

## How to add an image

- **Paste** — copy a screenshot (e.g. `PrtSc` / Snipping Tool) and press **Ctrl+V** in the chat box.
- **Drag & drop** — drop an image file onto the composer (a "Drop image to attach" overlay appears).
- **Upload** — click the **paperclip** in the composer and pick a file.

A thumbnail appears above the input. Hover it and click the **×** to remove it before sending. Click a
thumbnail to open a larger preview. You can send an image with or without text.

## Supported file types & limits

- **PNG, JPEG/JPG, WebP** — full support.
- **GIF** — accepted; the static first frame is used for the preview.
- The real type is detected from the file's bytes, so a renamed/mismatched file is rejected with a
  plain-English message (not by trusting the extension).
- **Max size:** ~10 MB per image (configurable: `maxImageAttachmentMB`).
- **Max dimensions:** 4096 px per side (configurable: `maxImageDimensionPx`); larger images are rejected
  with a message asking you to resize/crop.
- **Per message:** up to 4 images (configurable: `maxImagesPerMessage`).
- Empty, corrupt, or non-image files are rejected safely — DAWN never crashes on bad input.

## What happens locally

1. The image is validated (type + size + dimensions) and written to
   `%APPDATA%/DAWN/chat-attachments/` as a **content-addressed** file (`<sha256>.<ext>` → identical
   images are stored once).
2. A metadata row is saved in the `chat_attachments` SQLite table and associated with your message.
3. On send, if a vision model is configured, DAWN runs the **bundled multimodal runtime**
   (`llama-mtmd-cli`) on the image and injects its description into the chat as **untrusted evidence**
   (see security below). The reply is written by your normal chat model using that description.
4. The chat history shows the image thumbnail + an analysis status (attached / analyzing / analyzed /
   failed / vision unavailable).

## What model is needed

Full image understanding needs a **vision-capable GGUF model + its `mmproj` projector**, e.g.
**Qwen2.5-VL**, **LLaVA**, or **MiniCPM-V**. Install both files in the **Model Hub**, then set the model
paths (`vlmModelPath`, `vlmMmprojPath`) / the **Vision** role. The bundled `llama-mtmd-cli` runtime is
already present. `vision:capabilities` reports, honestly, whether image chat is ready.

If the **currently loaded chat model is text-only**, that's fine — DAWN uses the configured vision model
as a separate on-device analyzer and feeds the result to your chat model.

## "Vision unavailable" — what it means

If **no** vision model is configured, DAWN still lets you attach and send the image, but it will tell you
plainly that it **cannot see it** and will **not guess** the contents. System Health → **Vision Chat**
shows exactly what's missing and links to the Model Hub. This is by design: DAWN never pretends to have
analyzed an image it couldn't.

## OCR fallback

An OCR-only fallback (extracting text without full image understanding) is **not wired for arbitrary
uploaded images yet** — the existing Live Vision OCR runs on the webcam frame only. `vision:capabilities`
reports `ocr` availability honestly; today it is `false` for chat uploads. When OCR is used it will be
clearly labelled "I used OCR text fallback," and the text is treated as untrusted (below).

## Privacy & security

- **Local only.** Images never leave your PC; analysis runs on-device via bundled llama.cpp.
- **No path/EXIF/content leakage.** Only safe metadata (name, mime, size, dimensions, id, date) is ever
  shown in chat, workspace, or search. The full file path, content hash, raw bytes, and any OCR/vision
  text are **never** exposed to the renderer, workspace metadata, Global Search, or diagnostics.
- **No image content in logs or diagnostics.** The redacted diagnostics bundle contains no attachment
  bytes, paths, or OCR text.
- **Untrusted by default.** A screenshot can contain adversarial text ("ignore previous instructions",
  "run this", "send this token"). All OCR/vision text is wrapped as **UNTRUSTED evidence** and passed
  through DAWN's prompt-injection firewall — it is described/quoted, **never obeyed** as instructions,
  and never becomes a system/developer message.
- **Nothing is analyzed until you send the message.** No autonomous scanning of your files.

## Troubleshooting

- **Paste does nothing** — make sure an *image* is on the clipboard (some apps copy a file reference, not
  image bytes). Try the paperclip upload instead, or drag the file in.
- **Upload rejected** — check the type (PNG/JPEG/WebP/GIF) and that it's a real image; renamed non-images
  are rejected on purpose.
- **"This model cannot see images"** — no vision model is configured. Install a VLM + mmproj in the Model
  Hub and set the Vision role.
- **Image too large / wrong dimensions** — resize or crop; adjust `maxImageAttachmentMB` /
  `maxImageDimensionPx` in settings if you really need larger.
- **Corrupt image** — DAWN rejects it with a message rather than crashing; re-export the screenshot.
- **OCR unavailable** — expected today for chat uploads (see OCR fallback above).
