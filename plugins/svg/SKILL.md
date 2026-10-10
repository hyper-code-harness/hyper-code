---
name: svg
description: "Draw a picture as inline SVG when it is not a chart: a schema, a timeline, a state board, an annotated shape. Use when the exact placement, labels and colours carry the meaning and mermaid's auto-layout or a Vega-Lite chart does not fit — write a ```svg fence with the markup, or ```svg tsx to compute the drawing from data in TSX."
---

# svg

Takes SVG markup, strips everything that makes it more than a picture, and returns a figure that behaves in a chat column. No dependencies, no headless browser: the markup you write is the markup that renders.

Where it sits between the other drawing plugins:

- **vega-lite** — data has a shape and the chart is standard: bars, lines, areas, points. Do not hand-draw a bar chart.
- **mermaid** — a graph whose layout you are happy to leave to an algorithm.
- **reladraw** — boxes and arrows placed relative to each other, in a language built for it.
- **svg** — everything else: a timeline with real dates on a real scale, a state board, a shape with annotations, a legend laid out exactly so, a picture in the project's colours.

## Use

In Markdown — the fence renders inline, and markup that fails stays visible as code:

````markdown
```svg width=420
<svg viewBox="0 0 420 120" font-family="Inter, system-ui, sans-serif">
  <rect x="10" y="30" width="120" height="50" rx="8" fill="#7DA1EF"/>
  <text x="70" y="60" text-anchor="middle" font-size="13" fill="#fff">agent</text>
</svg>
```
````

The info string takes `width=` and `height=`, which override the drawing's own size.

From code:

- `svg.render({ svg, width?, height? })` → `{ html, svg, removed }` — sanitize and wrap markup as a figure. `removed` names the constructs that were stripped.
- `svg.sanitize({ svg })` → `{ svg, removed }` — the cleaning on its own, for SVG arriving from somewhere else.
- `svg.element({ tag, props?, children? })` → `{ markup }` — one element, with JSX attribute spelling translated. This is the JSX factory, callable by hand.
- `svg.tsx({ source })` → `{ svg }` — run a TSX drawing (see below).

## Computed drawings (`svg tsx`)

With `svg.allowEval` enabled, put `tsx` in the info string and the body becomes the body of an async function with `ctx`, `session` and JSX in scope. It must `return` an element:

````markdown
```svg tsx
const rows = await ctx.fns.procs.db.select({ sql: "select model, count(*)::int as n from agents group by 1 order by n desc limit 5" });
const max = Math.max(...rows.map(r => r.n));
return <svg viewBox="0 0 560 200" width={560} height={200} fontFamily="Inter, system-ui, sans-serif">
  {rows.map((r, i) => <rect x={190} y={40 + i * 40} width={r.n / max * 300} height={26} rx={4} fill="#7DA1EF"/>)}
</svg>;
```
````

What differs from React:

- JSX attributes use JSX spelling and are translated: `fontSize` → `font-size`, `textAnchor` → `text-anchor`, `className` → `class`. `viewBox`, `preserveAspectRatio`, `markerWidth`, `stdDeviation` and the other genuinely camelCase SVG attributes are kept as they are — hyphenating `viewBox` is the classic way to get a blank picture.
- `style` may be an object; `null`, `undefined` and `false` disappear from both attributes and children; arrays flatten, so `rows.map(...)` works.
- A local component — `const Box = ({ x }) => <rect x={x}/>` — works. There is no state, no hooks and no re-render: this runs once and produces text.
- Write `return`. A trailing bare `<svg/>` expression is dead code and the transpiler drops it, which would leave you with an empty drawing and no error.

**Security and lifecycle:** `svg.allowEval` is off by default. This is server-side code execution with full `ctx`, not a sandbox, and read-only behaviour is not enforced. Enable only when every rendered document is trusted. The code runs again on every render, including when history is reopened, so a drawing is a view of data now and not a saved snapshot — never write, send or mutate anything in one.

## Helpers for placing things

Five functions, callable from `svg tsx` (and from any runtime code), that replace the arithmetic that makes hand-drawn SVG slow and wrong. All of them return plain data or a node you can drop straight into JSX.

- **`svg.measureText({ text, size, weight?, mono? })`** → `{ width, height, em }`. How wide a string will be, from Helvetica's advance widths — within a few percent for Inter, Arial and the system sans stacks. Use it before placing anything next to a label; a guessed width is where overlap comes from.
- **`svg.label({ text, x, y, maxWidth?, size?, anchor?, fill?, ... })`** → `{ node, lines, width, height }`. A `<text>` that wraps. SVG has no wrapping of its own: this breaks on spaces, emits one `<tspan>` per line with the x repeated, and reports the box it took.
- **`svg.layout({ items, x, y, direction?, gap?, align? })`** → `{ boxes, width, height }`. Turns a list of sizes into placed boxes, each with `x/y/w/h` plus `cx/cy/right/bottom`. Write `b.cx`, not `y + i * 62` — insert an item and everything after it still lands correctly. Nest a row of columns freely.
- **`svg.connect({ from, to, style?, label?, head?, ... })`** → `{ node, start, end, mid }`. An arrow between two boxes, clipped to their borders rather than their centres, `straight` / `orthogonal` / `curve`. The head is a polygon, not a `<marker>` definition, so a loop producing fifty connectors never collides on ids. Boxes from `svg.layout` go straight in.
- **`svg.bbox({ svg, padding? })`** → `{ content, viewBox, fits, overflow, suggestedViewBox }`. What the drawing actually covers, and whether it sticks out of its `viewBox`. **Call this before showing a drawing** — it is the check that replaces squinting at a preview, and it names the side and the number of pixels. Known limits: `transform` is ignored, text width is estimated, stroke width is not counted — so one pixel of overflow is noise and twenty is real.

A drawing that uses them reads as layout rather than coordinates:

````markdown
```svg tsx
const { layout, label, connect } = ctx.fns.svg;
const col = layout({ items: [{ id: "parse" }, { id: "plan" }, { id: "run" }], x: 20, y: 20, gap: 24, itemWidth: 120, itemHeight: 40 });
return <svg viewBox="0 0 400 180" fontFamily="Inter, system-ui, sans-serif">
  {col.boxes.map(b => <g>
    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill="#EEF3FC" stroke="#DBE5F7"/>
    {label({ text: b.id, x: b.cx, y: b.cy + 4, anchor: "middle", size: 11 }).node}
  </g>)}
  {connect({ from: col.boxes[0], to: col.boxes[2], style: "curve", label: "retry" }).node}
</svg>;
```
````

- **`svg.grid({ cols, rows, width, height, gap?, areas? })`** → `{ cell, area, areas, colSizes, rowSizes }`. A CSS grid for a drawing, and the best way to think about a wireframe. Tracks are pixels, `"1fr"`, `"auto"` or `"25%"`; `cell({ col, row, colSpan, pad })` and `area("header")` return boxes with `cx/right/bottom`. Named `areas` describe a whole screen in one string per row — `["status", "header", "feed", "composer"]` — and a grid nests inside a cell of another one, which is how a phone screen sits inside a page.
- **`svg.stack({ items, box, justify?, align?, wrap?, gap?, fill? })`** → `{ boxes, width, height, fits }`. Distributes items inside a region, which is what `svg.layout` cannot do: `justify: "space-between"` for a toolbar with something at each end, `"center"` for a button row, `wrap: true` for a legend that runs onto a second line, `fill: true` to share the room equally. Each box comes back with `x/y/w/h` plus `cx/cy/right/bottom` and the line it landed on. Reach for it over `layout` whenever the available space matters and not just the starting point.
- **`svg.fitText({ text, box, size?, minSize?, maxLines?, overflow? })`** → `{ node, size, lines, fits, overflowBy }`. The end of "will this caption fit": the text is wrapped to the box and checked against its height, then `overflow` decides — `shrink` steps the font down to `minSize`, `ellipsis` cuts the last kept line, `ellipsis-middle` keeps both ends (what a file path needs), `clip` drops the extra lines, `none` only reports. Use it for any text whose length comes from data, and read `fits` instead of hoping.
- **`svg.debug({ grid?, boxes?, points? })`** → `{ node }`. Add it as the last child of the `<svg>` while building, delete it when done. Outlines every grid cell with its index and size, outlines boxes, marks anchors with a cross — the shortest path from "the picture looks wrong" to "that column is 12px narrow".
- **`svg.anchor({ of, at, place?, gap?, size? })`** → `{ x, y, box }`. "Under the left edge of that box, 8px down", as a call rather than four lines of arithmetic: `at` names one of the nine points of a box, `place` pushes away from it (`above`/`below`/`left-of`/`right-of`), `inside` turns the gap into padding. With `size` you get a whole box placed there, so a badge or a caption attaches and stays correct when the source moves.

## Write your own vocabulary first

The single biggest speed-up is not a plugin function: it is the three or four local helpers at the top of the fence. A drawing written as raw elements repeats the same offsets in every branch, and the repetition is where the mistakes live. Name the repeated shape once and the rest of the drawing reads as content.

````markdown
```svg tsx
const { label, layout, connect, measureText } = ctx.fns.svg;

// vocabulary — one line each, defined once
const TONE = {
  lead:  { fill: "#EEF3FC", stroke: "#B9CBEC", dot: "#7DA1EF" },
  plain: { fill: "#F6F9FE", stroke: "#DCE6F7", dot: "#8FAEE8" },
};
const box  = (b, fill, stroke) => <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill={fill} stroke={stroke}/>;
const bar  = (x, y, w, h, fill) => <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill}/>;
const card = (b, title, subtitle, tone) => <g>
  {box(b, TONE[tone].fill, TONE[tone].stroke)}
  <circle cx={b.x + 14} cy={b.y + 15} r={4.5} fill={TONE[tone].dot}/>
  {label({ text: title, x: b.x + 25, y: b.y + 18, size: 11, weight: 600 }).node}
  {label({ text: subtitle, x: b.x + 14, y: b.y + 33, size: 8.5, fill: "#9aa3b2" }).node}
</g>;

const col = layout({ items: rows, x: 20, y: 40, gap: 12, itemWidth: 160, itemHeight: 44 });
return <svg viewBox={`0 0 200 ${col.height + 60}`} fontFamily="Inter, system-ui, sans-serif">
  {col.boxes.map((b, i) => card(b, rows[i].name, rows[i].role, i ? "plain" : "lead"))}
</svg>;
```
````

A local function beats a CSS class here, and the reason is worth remembering: a class can only set colours, while `card(b, title, subtitle, tone)` carries the geometry, the text and the colours together — the part that actually takes time. `<style>` is removed anyway (see below), so this is the only vocabulary available.

**Reach for `svg.grid` before coordinates.** A wireframe is a grid; written as tracks it edits like one. Change `rows: [18, 44, "1fr", 46, 20]` to `[18, 52, "1fr", 46, 20]` and the header grows while everything below slides down on its own — no other number in the drawing moves.

````markdown
```svg tsx
const screen = ctx.fns.svg.grid({
  cols: ["1fr"], rows: [18, 44, "1fr", 46, 20],
  x: 20, y: 20, width: 250, height: 520,
  areas: ["status", "header", "feed", "composer", "home"],
});
const header = screen.area("header"), feed = screen.area("feed");
```
````

**`measureText` is an estimate; `exact: true` makes it true.** Widths come from Helvetica metrics, and anything outside ASCII — every Cyrillic label — is approximated at 0.55em per character. Passing `exact: true` to `svg.label` emits `textLength` on each line, which tells the renderer to draw it at exactly the width we computed. The estimate stops being a guess about the drawing and becomes a property of it, so a label cannot overrun the box it was measured into whatever font the reader has. `svg.fitText` does this by default, since otherwise its `fits` would only hold for the font we guessed with.

**Call `svg.bbox` before showing a drawing, every time.** It catches real mistakes, and a preview tool will not: `qlmanage` and friends crop to their own square and report an overflow that is not there. Trust `bbox`, not the thumbnail.

Three habits that make a drawing survive editing:

- **Never write a coordinate twice.** Derive it: `b.cx`, `b.right`, `col.height`, `measureText(...).width + 28`. A literal that appears in two places will disagree with itself after the first change.
- **Size the container from its content, not the other way round.** Compute the boxes first, then `const W = Math.max(...boxes.map(b => b.right)) + PAD` and build the `viewBox` from it. Then nothing can be clipped by construction.
- **Draw connectors before the boxes.** They are then under the cards instead of across their labels, with no z-order to manage.

## What sanitizing removes

Always, in both modes: `<script>`, `<style>`, `<foreignObject>`, SMIL animation elements, every `on*` handler, and any `href` or `url()` pointing outside the drawing. References inside the drawing (`#marker`, `url(#grad)`) and inline `data:image/...` survive, so gradients, markers and clip paths work normally. A missing `xmlns` is added — without it a browser silently renders nothing — and a drawing sized in pixels with no `viewBox` gets one, so it scales down in a narrow column instead of being clipped.

## Tips

- Give the root a `viewBox` and leave `width`/`height` to the fence info string; the figure then scales to the column.
- Text has no layout engine here: a label is placed where you put it. Leave room between elements, and use `text-anchor="middle"` with the centre coordinate rather than guessing the left edge.
- For a non-ASCII drawing set `font-family` on the root (`Inter, system-ui, sans-serif`) so it matches the host UI.
- `class` survives sanitizing and the page's Tailwind stylesheet applies, so `class="fill-sky-500"` works on screen — but a drawing saved to a file or opened on its own then has no colours. Use plain attributes and inline `style` for anything that must stand alone, and treat classes as an in-page convenience only.
- Before you show it, run `svg.bbox` over the markup. It catches the clipped caption that a preview tool would have hidden from you — and do trust it over an image preview: `qlmanage` and friends crop to their own square and will make you "fix" a drawing that already fitted.
- A drawing that needs the same shape more than twice wants a local function, not a copied block. See *Write your own vocabulary first*.
