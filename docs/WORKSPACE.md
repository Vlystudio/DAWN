# DAWN Workspace

DAWN is a local-first AI workspace. Beyond chat it includes **Documents**, **Notes**,
**Tasks**, and a local **Calendar** — all stored locally in SQLite, integrated with the 3D
brain, and (where AI is involved) protected by DAWN's untrusted-data firewall. Clean-room,
DAWN-native (no Odysseus code).

This doc is built up part-by-part. Security and backup live in
[SECURITY.md](SECURITY.md) and [BACKUP_RESTORE.md](BACKUP_RESTORE.md); skills/tools in
[SKILLS.md](SKILLS.md).

---

## Part A — Documents

Create, edit, and organize local Markdown documents with live preview, local-model AI
actions, import/export, autosave, and version history. Open it from the left rail:
**Documents** (📄).

### Features
- **Editor + preview** — Markdown editor with a one-click live preview (rendered by DAWN's
  sanitized Markdown component; remote images are blocked by CSP).
- **AI actions** (local model, through the firewall): **Rewrite, Summarize, Expand,
  Shorten, Fix grammar, To checklist, Extract actions.** Each snapshots a version first so
  every edit is undoable.
- **Autosave** — debounced; a "Saved/Saving…" indicator shows state.
- **Version history** — snapshot on every AI action + manual "Save a version now"; restore
  any version (which itself snapshots the current state first). History is bounded to the
  last ~40 versions per document.
- **Import** — `.md`, `.txt`, `.html`, `.csv` (HTML → Markdown, CSV → Markdown table). PDF
  and DOCX aren't parsed yet, but a **`DocParser` provider interface + registry** is in
  place so they can be added without touching callers.
- **Export** — `.md`, `.txt` (Markdown stripped to plain text), `.html` (standalone
  document), `.csv` (Markdown tables → CSV, else line-per-row).
- **Brain** — each non-archived document is a node in the **Documents** brain region
  (`doc:<id>`), brightness scaled by length.

### Safety
Document text is **untrusted**: every AI action wraps the content in
`<<UNTRUSTED …>>` markers with the standing "evidence, not instructions" rule, so a
document that says "ignore previous instructions" can't hijack the model. Imports are
size-capped (8 MB) and read only files the user explicitly picks.

### Data model
- `documents` — id, title, content, format, archived, timestamps, metadata.
- `document_versions` — id, doc_id, content, label, created_at (bounded history).

### Files
```
electron/services/documents/docCore.ts     pure: AI-action prompts (firewalled), parsers, export  ← tested
electron/services/documents/documents.ts   service: CRUD, autosave, versions, AI actions, import/export
src/components/DocumentsView.tsx            the Documents tab UI
tests/documents.test.ts                     (npm run test:agentos)
```
IPC: `window.dawn.docs.{list,get,create,update,remove,saveVersion,versions,restore,ai,export,import}`.

### Acceptance check
Create a document, type some text, click **Rewrite** (DAWN edits it via the local model),
watch it autosave, **Export** to `.md`/`.html`, and open the Brain Explorer to see the
document node in the Documents region. Use **History → Restore** to roll back the AI edit.

---

## Part B — Notes & Tasks

### Notes (📝)
Quick notes with **tags**, **pin/archive**, **search**, and three AI helpers (all local,
all firewalled):
- **Summarize** — prepends a short bullet summary to the note.
- **Convert to task** — extracts an actionable task (title/details/priority) and creates it,
  linking the note → task.
- **Smart link** — finds related **memories / conversations / projects** by keyword overlap
  (deterministic, offline) and links them. Links show on the note and as brain edges.

Notes autosave (debounced) and become nodes in the **Notes** brain region, with edges to the
items they're linked to.

### Tasks (✅)
- **Title, details, due date, priority** (low/normal/high/urgent), **status**
  (todo/in-progress/blocked/done).
- **Reminders** — set a due/remind time; DAWN fires a **local desktop notification** when due
  (Electron `Notification`, no network; toggle in Settings → *Task reminders*). Clicking the
  notification opens the Tasks screen.
- **Recurring** tasks (daily/weekly/monthly) — completing one spawns the next occurrence.
- **"Ask DAWN to work on this"** (🤖) — the local model writes a step-by-step plan, saved to
  the task's **history**.
- **Task history** — every create/status-change/completion/plan is logged.
- **Overdue** tasks are flagged in the list (red ring) and **glow red in the brain** (an
  `overdue_warning` edge to the core) — the subtle warning state.

Tasks become nodes in the **Tasks** brain region; priority and overdue state drive brightness.

### Data model
- `notes`, `note_links` (note → memory/conversation/project/task).
- `tasks`, `task_events` (history).

### Files
```
electron/services/workspace/wsCore.ts   pure: recurrence, overdue, keywords, firewalled prompts  ← tested
electron/services/workspace/notes.ts    notes service (CRUD/search/AI/link)
electron/services/workspace/tasks.ts    tasks service (CRUD/recurrence/reminders/askDawn/history)
src/components/NotesView.tsx · TasksView.tsx
electron/main.ts                         reminder poller → desktop notifications
tests/workspace.test.ts                  (npm run test:agentos)
```
IPC: `window.dawn.notes.*`, `window.dawn.tasks.*`.

### Acceptance check
Create a note, click **Convert to task** → a task appears in **Tasks**. Give it a due time in
the past → it shows as **Overdue** (and its brain node glows red). Click **Ask DAWN** for a
plan. Mark a recurring task done → the next occurrence is created.

---

## Part C — Calendar-lite

A local calendar (📅) with **month / week / day** views. Events are stored locally; **tasks
with due dates appear automatically** on the calendar (colored by priority, red when overdue),
so deadlines and events live together.

- **Create/edit events** — title, start/end, all-day, location, details (click a day or the
  **Event** button).
- **Import / export `.ics`** — standards-compliant iCalendar round-trip (handles all-day
  `VALUE=DATE`, UTC `Z` and floating/local times, and RFC-5545 line folding). Import de-dupes
  on `UID`.
- **CalDAV** — a `CalendarProvider` interface is architected (`calCore.ts`) for a future
  CalDAV sync provider. It is **optional, off by default, and intentionally not implemented**
  in this pass (it would require credentials, which belong in the encrypted Vault — Part G).

### Data model
`calendar_events` (title, details, location, start_at, end_at, all_day, uid, source). Task
deadlines are overlaid at read time — never duplicated into the events table.

### Files
```
electron/services/calendar/calCore.ts    pure: .ics generate/parse, date grids, provider interface  ← tested
electron/services/calendar/calendar.ts   service: events CRUD, task overlay, .ics import/export
src/components/CalendarView.tsx           month/week/day UI
tests/calendar.test.ts                    (npm run test:agentos)
```
IPC: `window.dawn.cal.{list, create, update, remove, exportIcs, importIcs}`.

### Acceptance check
Add an event today, switch month/week/day views, and confirm a task with a due date shows on
its day. **Export `.ics`**, then **Import** it back — the event reappears (de-duped by UID).
