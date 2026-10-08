---
name: mermaid
description: "Render Mermaid diagrams to inline SVG: flowchart, sequence, state, class, ER, xychart, gantt, timeline, pie, journey, quadrant, mindmap, sankey, git graph, block, radar, kanban, treemap, requirement and C4. Use when an auto-laid-out diagram is enough; write a ```mermaid fence in any Markdown Hyper shows, or call mermaid.render for the HTML fragment. For a project timeline write a gantt fence instead of reaching for vega-lite. When the arrangement itself matters, use reladraw instead."
---

# mermaid

Renders Mermaid with `beautiful-mermaid` into a responsive, light-palette SVG with no external font imports.

Twenty diagram types are supported:

- **Graphs** — `flowchart`, `stateDiagram-v2`, `sequenceDiagram`, `classDiagram`, `erDiagram`, `gitGraph`, `block-beta`, `mindmap`, `requirementDiagram`, `C4Context` (and `C4Container` / `C4Component` / `C4Dynamic` / `C4Deployment`)
- **Time** — `gantt`, `timeline`
- **Quantities** — `xychart-beta`, `pie`, `sankey-beta`, `radar-beta`, `treemap-beta`, `quadrantChart`
- **Boards** — `journey`, `kanban`

A project plan, a roadmap or a career history belongs in a `gantt` fence — it takes real dates and draws a real time axis, so there is no reason to reach for a chart library:

```mermaid
gantt
    title Roadmap
    dateFormat YYYY-MM-DD
    section Build
    Parser      :done,   2024-01-01, 60d
    Layout      :active, after Parser, 45d
    Ship        :milestone, 2024-06-01, 0d
```

## Use

- In Markdown (chat answers, docs, notes, SKILL.md pages) write a fence — it renders inline; if it fails to compile the block stays visible as code:

```mermaid
flowchart LR
  A(Request):::blue2 --> B(Worker) --> C[(Postgres)]
```

- `mermaid.render({ source })` → HTML fragment `<div class="mermaid-diagram">…<svg>…</div>`.

Palette classes: `red`, `blue`, `violet`, `green`, `yellow`, `neutral` with a stroke width digit — `A:::blue2` or `class A red1`; the `classDef` is injected unless you write your own.

Frontmatter works too — `---\ntitle: …\nconfig: { … }\n---` before the diagram, and `accTitle:` / `accDescr:` become the SVG `<title>` and `<desc>`.

Mermaid decides the layout itself. For diagrams where you must say what sits where, use the `reladraw` plugin.
