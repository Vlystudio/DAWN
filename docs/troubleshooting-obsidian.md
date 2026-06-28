# DAWN — Obsidian Troubleshooting

| Symptom | Fix |
|---|---|
| **"No vault connected"** | Obsidian page → **Select vault**, pick your vault folder. |
| Connect says **not writable** | Pick a folder you own (not a read-only/synced-locked location); close other apps locking it. |
| Search returns nothing | Click **Rebuild index** after connecting (or after adding many notes). |
| New notes don't appear in search | The index updates on write; for bulk external edits, **Rebuild index**. (A live file-watcher is a planned enhancement.) |
| DAWN isn't using my notes in chat | Enable **Obsidian integration** *and* **Search vault during chat**; make sure the index has notes (shown as "N notes · M chunks"). |
| Citations point to a note but it won't open | The note path is absolute on disk; open from the **Search** results or the Brain Explorer. |
| Secrets ended up `[REDACTED …]` | That's secret detection. Turn it off (Obsidian → Secret detection) only if you trust the content. |
| Graph export empty | Connect + ensure the vault has `.md` files; then **Export graph** → `Dawn/Graph/brain_graph.json`. |
| Duplicate-looking notes | DAWN appends timestamped updates to the same slug; very different titles create separate notes by design. |
| Obsidian isn't running | Not required — DAWN reads/writes the folder directly. Open Obsidian later to browse. |

**Where things live:** vault index is in `%APPDATA%\DAWN\dawn.db` (`vault_chunks`).
Logs of vault activity are on the **Logs** page (source `vault`) and in
`%APPDATA%\DAWN\logs\dawn.log`.

**Reset the vault index:** disconnect isn't required — just **Rebuild index** (it
clears and re-indexes). To stop all vault use, set memory mode **Off** and disable
the integration toggle.
