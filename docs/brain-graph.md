# DAWN — Brain Graph (from the vault)

DAWN's visual **Brain Explorer** is driven by a real data graph. With Obsidian
connected, your vault becomes part of that graph.

## Export

**Obsidian page → Export graph** runs the GraphBuilder, which scans your vault's
Markdown and writes:

```
Dawn/Graph/brain_graph.json
```

## What it parses

| Source | Becomes |
|---|---|
| `[[WikiLinks]]` | `link` edges between notes |
| `#tags` | `tag` nodes + `tag` edges |
| Folders | grouping |
| Frontmatter `type:` | node type (memory, project, conversation, …) |
| Frontmatter `project:` | `project` nodes + `project` edges |
| Note titles (`# H1`) | node labels |

## JSON shape

```json
{
  "generated": "2026-06-25T…",
  "nodes": [{ "id": "Dawn/Memories/AI/dawn-obsidian.md", "type": "memory", "title": "…", "project": "Dawn", "summary": "…" }],
  "edges": [{ "source": "…", "target": "tag:local-ai", "type": "tag" }]
}
```

## In the Brain Explorer

The Explorer already renders DAWN's SQLite graph (conversations, memories,
projects, rules, tools) as glowing neuron/galaxy nodes you can **zoom, rotate,
hover (summary on hover), click (open the note/conversation), filter by type, and
search**. Indexed vault notes appear in the **Knowledge** region. The exported
`brain_graph.json` is a portable copy you can also open in Obsidian's own graph or
feed to other tools.

> Node colors map to region (memories = violet, knowledge = green, projects =
> teal, logic = amber, tools = blue, conversations = cyan).
