---
name: mermaid
description: "Render Mermaid diagrams to inline SVG: flowchart, sequence, state, class, ER, xychart, gantt, timeline, pie, journey, quadrant, mindmap, sankey, git graph, block, radar, kanban, treemap, requirement and C4. Use when an auto-laid-out diagram is enough; write a ```mermaid fence in any Markdown Hyper shows, or call mermaid.render for the HTML fragment. For a project timeline write a gantt fence instead of reaching for vega-lite. When the arrangement itself matters, use reladraw instead."
---

# mermaid

Renders Mermaid with `beautiful-mermaid` into a responsive, light-palette SVG with no external font imports.

Twenty diagram types are supported. Pick by what the picture has to say, not by what is familiar:

| Header | Draws | Reach for it when |
| --- | --- | --- |
| `flowchart` | boxes and arrows, auto-placed | a process, a pipeline, a decision tree |
| `sequenceDiagram` | lifelines and messages in order | who calls whom, and in what order |
| `stateDiagram-v2` | states and transitions | a machine with modes and events |
| `classDiagram` | types, fields, relations | a data model or an API's shape |
| `erDiagram` | entities and cardinality | database tables and their keys |
| `gitGraph` | commits, branches, merges | explaining a branching strategy |
| `block-beta` | a fixed grid of blocks | an architecture slide, layers in columns |
| `mindmap` | a radial tree | breaking one idea into parts |
| `requirementDiagram` | requirements and what satisfies them | traceability: asked for vs provided |
| `C4Context` | people, systems, nested boundaries | software architecture at one zoom level (also `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`) |
| `gantt` | bars on a real date axis | a plan, a roadmap, a history — **anything with dates** |
| `timeline` | events along one line | a sequence of moments, no durations |
| `xychart-beta` | bars and lines on x/y | a measured series |
| `pie` | slices of one whole | parts of a total, few categories |
| `sankey-beta` | weighted flows | where a quantity goes as it moves |
| `radar-beta` | one closed curve per series | comparing several things on the same axes |
| `treemap-beta` | nested rectangles by area | a hierarchy where size is the point |
| `quadrantChart` | points in a 2×2 grid | a position in the unit square (effort vs value) |
| `journey` | steps scored by sentiment | a user's path and where it hurts |
| `kanban` | columns of cards | state of work in progress |

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

Frontmatter works too, and `accTitle:` / `accDescr:` become the SVG `<title>` and `<desc>`:

```mermaid
---
title: Share of output
config:
  pie:
    textPosition: 0.6
---
pie
  "SVG" : 70
  "ASCII" : 30
```

Mermaid decides the layout itself. For diagrams where you must say what sits where, use the `reladraw` plugin.
