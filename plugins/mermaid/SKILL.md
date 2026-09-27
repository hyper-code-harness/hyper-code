---
name: mermaid
description: "Render Mermaid diagrams (flowchart, sequence, state, class, ER) to inline SVG. Use when an auto-laid-out diagram is enough; write a ```mermaid fence in any Markdown Hyper shows, or call mermaid.render for the HTML fragment. When the arrangement itself matters, use reladraw instead."
---

# mermaid

Renders Mermaid with `beautiful-mermaid` into a responsive, light-palette SVG with no external font imports.

## Use

- In Markdown (chat answers, docs, notes, SKILL.md pages) write a fence — it renders inline; if it fails to compile the block stays visible as code:

```mermaid
flowchart LR
  A(Request):::blue2 --> B(Worker) --> C[(Postgres)]
```

- `mermaid.render({ source })` → HTML fragment `<div class="mermaid-diagram">…<svg>…</div>`.

Palette classes: `red`, `blue`, `violet`, `green`, `yellow`, `neutral` with a stroke width digit — `A:::blue2` or `class A red1`; the `classDef` is injected unless you write your own.

Mermaid decides the layout itself. For diagrams where you must say what sits where, use the `reladraw` plugin.
