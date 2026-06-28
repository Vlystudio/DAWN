# DAWN — Obsidian Integration

Use an **Obsidian vault** as DAWN's long-term local memory & knowledge base.
DAWN writes Markdown notes and searches/reasons over the vault during chat.
Plain Markdown files, treated as a local folder — **Obsidian does not need to be
running**, and nothing is ever uploaded.

## Connect

1. Open **Obsidian** in DAWN's sidebar.
2. **Select vault** → choose your Obsidian vault folder. DAWN creates a `Dawn/`
   folder structure inside it and an `Index.md`.
3. **Rebuild index** to embed your existing notes for search.
4. Toggle **Enable Obsidian integration** and **Search vault during chat**.

## Folder structure (auto-created under `Dawn/`)

```
Dawn/
  Inbox/  Daily/
  Memories/{Personal,Projects,Work,Health,Gardening,Beekeeping,Photography,Finance,AI,Code}/
  Projects/{Dawn,Daybreak,Grocery AI,Beekeeping Software,Home AI}/
  Conversations/  Decisions/  Tasks/  People/  Systems/  Research/  Attachments/  Graph/
  Index.md
```

## How it works

| Service | Role |
|---|---|
| **VaultManager** (`vault.ts`) | connect / pick / test / create structure / open |
| **MarkdownWriter** (`vault.ts`) | write memory / conversation / daily / project notes with frontmatter, `[[backlinks]]`, tags; **dedup** (append timestamped updates); **secret redaction** |
| **EmbeddingIndex + VaultSearch** (`vaultIndex.ts`) | chunk notes by heading, local embeddings → SQLite, brute-force cosine + keyword search with note/heading citations |
| **GraphBuilder** (`vaultGraph.ts`) | parse `[[links]]`/`#tags`/folders → `Dawn/Graph/brain_graph.json` |

## In chat

- When enabled, DAWN searches the vault for each question, injects relevant note
  excerpts into the prompt, and **cites the notes used** (shown under the answer).
- **Save to Obsidian** button (chat header) writes the conversation as a note.
- **Memory modes** (Obsidian page): Off · Manual approval · Auto-save important ·
  Auto-save everything (conversation summaries).

## Note format

```markdown
---
type: memory
category: project
project: Dawn
created: 2026-06-25
source: dawn-chat
confidence: 0.8
tags: [dawn, local-ai, obsidian, memory]
---

# Dawn Obsidian Integration

Summary:
...

Related:
- [[Dawn]]
- [[Local AI]]

Tasks:
- [ ] ...
```

## Recommended setup (your use case)

Create these project folders (DAWN seeds most automatically) and let memory mode
= **Manual approval** at first:

- **Projects/**: Dawn, Daybreak, Grocery AI, Beekeeping Software, Home AI
- **Memories/**: Beekeeping, Gardening, Work, AI, Code, Finance, Photography, Health
- **Systems/**: your hardware (RTX 4080 Super, 64 GB RAM), local AI models, voice config
- **Research/**: web findings you want kept

Then: connect vault → Rebuild index → enable "Search vault during chat". As you
chat, use **Save to Obsidian** on useful conversations; DAWN will cite those notes
in future answers and show them in the Brain Explorer's knowledge region.

See also: [memory-system](memory-system.md) · [brain-graph](brain-graph.md) ·
[privacy-and-secrets](privacy-and-secrets.md) · [troubleshooting-obsidian](troubleshooting-obsidian.md)
