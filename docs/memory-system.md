# DAWN — Memory System

DAWN has **two complementary local memories**, both fully on-device:

1. **Quick memory** (SQLite `memories` table) — short facts/preferences you pin in
   the **Memory** page. Recalled into chat and shown as "Used memory: …".
2. **Obsidian vault memory** (Markdown notes) — durable, browsable, linkable
   long-term knowledge. This doc focuses on the vault memory.

## What gets saved

From a conversation (or an explicit save), DAWN can capture: important facts,
preferences, decisions, project updates, tasks, bugs, ideas, code-architecture
notes, personal notes, beekeeping/gardening observations, hardware/software
config, and research summaries.

Each memory note records: **date, source conversation id, category, tags, related
notes, confidence, original excerpt (when useful), summary, backlinks.**

## Memory modes (Obsidian page)

| Mode | Behavior |
|---|---|
| **Off** | DAWN never writes to the vault. |
| **Manual approval** | You click **Save to Obsidian**; nothing auto-saves. (Recommended start.) |
| **Auto-save important** | DAWN writes notable memories automatically. |
| **Auto-save everything** | DAWN writes a conversation summary note after each chat. |

## Deduplication & history

Before creating a note, DAWN slugs the title and checks for an existing note. If
one exists, it **appends a timestamped `## Update …` section** instead of making a
duplicate — so history is preserved in one place.

## Privacy

- Saving sensitive content is gated by **secret detection** (redacts API keys,
  passwords, tokens, private keys, SSNs, cards) unless you explicitly allow it.
- Memory can be disabled entirely (mode = Off, or the global Memory toggle).
- Everything stays local; no note content is sent anywhere.

See [privacy-and-secrets](privacy-and-secrets.md).
