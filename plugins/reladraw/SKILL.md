---
name: reladraw
description: "Draw diagrams in the reladraw language, where you say where things go (right of, below, level with) instead of letting an auto-layout decide. Use for architecture and flow diagrams whose arrangement matters: render to SVG, validate source, or write a ```reladraw fence in Markdown to show the diagram inline."
---

# reladraw

A text language for diagrams with **relative placement**: every node is placed against another (`right of app`, `below app.ui`, `level with store`), so the picture you describe is the picture you get — no coordinates, no auto-layout guessing. Library: npm `reladraw` 0.9.0 (pinned; the syntax is still changing).

## Workflow

1. Write the source. `reladraw.validate({ source })` → `{ ok, problems: [{ line, message }] }` — fix by line.
2. `reladraw.render({ source, theme?, fontSize?, margin? })` → `{ svg, width, height }` — a standalone SVG to save or send.
3. In any Markdown Hyper renders (chat answers, docs, notes) a fenced block renders inline:

````markdown
```reladraw light
node app "Web app"
node app.ui  "Interface"
node app.api "API"  below app.ui
node store "Database"  right of app  level with app
edge app.api -> store  "queries"  from: right  to: left
```
````

The first word after `reladraw` on the fence line is an optional theme. A block that fails to compile stays visible as code — run `validate` to see why. The block above renders like this:

```reladraw light
node app "Web app"
node app.ui  "Interface"
node app.api "API"  below app.ui
node store "Database"  right of app  level with app
edge app.api -> store  "queries"  from: right  to: left
```

## Syntax essentials

- One statement per line; `//` comments; indentation ignored.
- `node <name> ["text"] [placements] [attributes]` — `a.b` is a child inside `a` (declare the parent first). Text ` / ` breaks a line.
- Placements: `right of X`, `left of X`, `above X`, `below X`, `level with X` (same row), gap per placement `below X (gap: tight)`.
- Exactly one node must be unplaced — it anchors the diagram; everything else is placed relative to something.
- `edge a -> b "label"  from: right  to: left` — sides the line leaves/arrives on.
- `diagram  theme: light` — themes: dark (default), light, solarized-dark/light, gruvbox-dark/light, catppuccin-mocha/latte, nord, dracula, vesper, high-contrast-dark/light, print.
- `style <name> fill: #14532d border: ...`, `default leaf|container|edge ...` for shared looks; colors may be `theme-primary`, `theme-muted`, ... to follow the theme.

Full reference: `plugins/reladraw/node_modules/reladraw/SYNTAX.md` (read sections on demand, it is long).
