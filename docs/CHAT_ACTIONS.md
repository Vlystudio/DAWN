# DAWN — Chat Cross-Feature Actions

Every assistant reply in **Chat** has an actions row (hover the message): **Note · Task · Doc ·
Remember**, alongside Copy / Read aloud / Regenerate. These turn a real reply into a real workspace
object and **link it back** to the conversation — chat becomes an entry point to your workspace.

## Actions

| Button | Creates (real service) | Link |
|---|---|---|
| **Note** | a Note (`notes.create`) | note → `created_from` → conversation |
| **Task** | a Task (`tasks.create`, source = chat) | task → `created_from` → conversation |
| **Doc** | a Document (`documents.create`, markdown) | document → `created_from` → conversation |
| **Remember** | a Memory (`memory.add`) | memory → `created_from` → conversation |

After a successful action a green confirmation appears with an **Open** link that jumps to the new
item's page. On failure you get a clear message (e.g. "Memory is disabled or could not be saved.") —
**no fake success, no silent failure**.

## What happens under the hood

1. The action reads the real message by id (`messages` table) — it never invents content.
2. It calls the existing feature service to create the object.
3. It registers a **Workspace Graph** item for both the conversation and the new object (idempotent),
   and creates a `created_from` link.
4. Because the new object is a real row, **auto-registration** + **Global Search** + the **Brain**
   all pick it up; **workspace related-lookup** on the conversation shows what came out of it.

## Honesty / safety

- Actions only exist for services that are actually implemented (notes/tasks/documents/memory).
- Nothing is sent anywhere; these are all local creates. No autonomous email/shell.
- Memory respects the memory-enabled setting — if memory is off, the action returns an honest error
  instead of pretending.

IPC: `chat:message:saveAsNote` · `chat:message:createTask` · `chat:message:createDocument` ·
`chat:message:saveAsMemory` · `chat:message:linkItem`. Service:
`electron/services/workspace/chatActions.ts`.
