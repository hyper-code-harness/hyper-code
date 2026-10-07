---
name: excalidraw
description: "Hand-drawn Excalidraw sketches that agents and people edit together. Use when a diagram should look like a whiteboard sketch or the user wants to rearrange it by hand: create it with excalidraw.write (from Mermaid, a simple element skeleton or full elements), give the user /excalidraw/<name> to edit, read their changes back with excalidraw.read, and show it inline with a ```excalidraw fence."
---

# excalidraw

Drawings are files: `<root>/<name>.excalidraw` (the scene) and `<name>.svg` (a preview the editor exports on every save). Root is the `excalidraw.root` setting, default `drawings/` in the project.

## Workflow

1. Create: `excalidraw.write({ name, mermaid })` — easiest; or `skeleton: [{ type: "rectangle", id: "a", x: 0, y: 0, label: { text: "API" } }, { type: "arrow", x: 0, y: 0, start: { id: "a" }, end: { id: "b" } }]`; or full `elements`.
2. Open: give the user `/excalidraw/<name>` (or `ui.openUrl`). Mermaid/skeleton are converted to real elements on first open, then the editor autosaves scene + SVG.
3. Read back: `excalidraw.read({ name })` → `outline` lists shapes, labels and arrows; `svg` is the preview.
4. Show inline in Markdown:

````markdown
```excalidraw
butler
```
````

The block body is just the drawing name. Before the first open there is no preview, so the fence shows only the editor link.

`/excalidraw` lists all drawings. The editor loads Excalidraw from esm.sh, so it needs internet access in the browser.
