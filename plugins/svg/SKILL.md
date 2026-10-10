---
name: svg
description: "Draw a picture as inline SVG when it is not a chart: a schema, a timeline, a state board, an annotated shape. Use when the exact placement, labels and colours carry the meaning and mermaid's auto-layout or a Vega-Lite chart does not fit — write a ```svg fence with the markup, or ```svg tsx to compute the drawing from data in TSX."
---

# svg

Takes SVG markup, strips everything that makes it more than a picture, and returns a figure that behaves in a chat column. Rendering needs no layout engine or headless browser: the markup you write is the markup that renders.

## Nested rows and columns with Yoga

Use `svg.flexLayout({ root, width?, height? })` for a block hierarchy: panels,
rows, columns, equal-share cards and wrapping groups. It uses pinned
`yoga-layout@3.2.1` (MIT), bundled ESM/WASM, entirely in Bun; install dependencies
with `cd plugins/svg && bun install --frozen-lockfile`. No Python or system
library is needed. The plugin resolves its own installed package, not a `/tmp`
experiment. `FlexNode` and `FlexLayoutResult` are available as `types.svg.*`.

Each node has a unique `id`, optional ordered `children`, pixel `width`/`height`,
`minWidth`/`maxWidth`/`minHeight`/`maxHeight`, `direction: 'row' | 'column'`,
`gap`, uniform or `{top,right,bottom,left}` padding, `align`, `justify`, `wrap`,
`grow` and `shrink`. Defaults: column, stretch, start, no wrap, zero spacing and
zero grow/shrink. Grow shares free space **in addition to the natural item size**;
use equal widths (or unsized leaves) for equal shares. Wrapping lines align to
cross-axis start. All numbers are finite and nonnegative, at most 1,000,000;
min cannot exceed max. Maximum 1000 nodes and 64 levels, counting the root.
Unknown node fields are rejected. Root `null` is an empty layout.

The result is `{ boxes: Record<id, {x,y,width,height}>, order, bounds }`.
Containers are included; `order` is depth-first input order. Coordinates are
absolute from the root, without pixel rounding; bounds include overflowing
children. An omitted dimension is intrinsic or stretched, not measured text.
Call `svg.measureText`/`svg.fitText` outside layout and pass card dimensions.
There is no font measurement, CSS grid, margin, percentage sizing, edge routing
or SVG rendering in this helper. Nodes/configuration are freed after every call.

```svg tsx
const layout = await ctx.fns.svg.flexLayout({
  width: 420,
  root: { id: 'panel', direction: 'row', padding: 16, gap: 12,
    children: [{ id: 'Left', grow: 1, height: 80 },
               { id: 'Right', grow: 1, height: 80 }] }
});
const b = layout.bounds;
return <svg viewBox={`${b.x} ${b.y} ${b.width} ${b.height}`}>
  {layout.order.map(id => {
    const box = layout.boxes[id];
    return <g><rect {...box} rx="8" fill={id === 'panel' ? '#e2e8f0' : '#fff'}
      stroke="#64748b" />{id !== 'panel' &&
      <text x={box.x + box.width/2} y={box.y + box.height/2}
        text-anchor="middle" dominant-baseline="middle" fill="#0f172a">{id}</text>}</g>;
  })}
</svg>
```

Choose **Yoga** when nesting and item order define the layout; **ACA** plus
`snapLayoutToGrid` when graph relationships should determine placement;
**svg.grid** when explicit two-dimensional tracks and spans define the structure.
Yoga does not optimize graph crossings. Connect the resulting boxes separately.
The four-group Kubernetes fixture is `fixtures/flex-kubernetes.json` with its
rendered `fixtures/flex-kubernetes.svg`; equal-share cards stay in semantic groups.

Where it sits between the other drawing plugins:

- **vega-lite** — data has a shape and the chart is standard: bars, lines, areas, points. Do not hand-draw a bar chart.
- **mermaid** — a graph whose layout you are happy to leave to an algorithm.
- **reladraw** — boxes and arrows placed relative to each other, in a language built for it.
- **svg** — everything else: a timeline with real dates on a real scale, a state board, a shape with annotations, a legend laid out exactly so, a picture in the project's colours.

## Preferred automatic workflow for entity and concept maps

Start with `svg.layoutIncremental({ nodes, edges })` (ACA), then pass its original
result to `svg.snapLayoutToGrid({ layout: aca })`. This is the preferred starting
point from the interactive Kubernetes, QBO and agent-storage examples: ACA supplies
relative positions; a coarse grid and Hungarian assignment make regular rows and
columns. Do not substitute radial compaction or shelf packing for this workflow.

Use actual card dimensions including subtitles/fields when planning. Keep IDs and
edges unchanged between comparisons. Inspect the rendered result: assignment does
not consider edges, so links may cross other cards. Use `svg.connect` for straight
border-clipped connectors; `svg.routeEdges` can avoid obstacles but independent
routes may share lanes. Neither guarantees readable connections.

Use a short horizontal coloured rule below card titles, not a vertical side accent.
Derive the SVG viewBox from actual bounds and reserve space for title and notes.
Label relationship meanings where needed and distinguish entities from embedded
structures or actions. For database maps, inspect the live schema; do not imply
that logical links are enforced foreign keys.

If manually changing coordinates, say so. The older ACA/manual-refinement and
compaction sections below are optional alternatives, not this automatic default.

## Assign an ACA layout to a near-square grid

`await ctx.fns.svg.snapLayoutToGrid({ layout, gapX: 50, gapY: 50, occupancy: 1, columns? })`
returns a new `GraphLayoutResult`, without changing `compactLayout` or the input.
Use original ACA output as `layout`, not an already compacted result.

For N boxes, M = ceil(N / occupancy). Let maxW/maxH be the largest box dimensions.
For each c = 1..M, r = ceil(M/c), W = c*maxW + (c-1)*gapX and
H = r*maxH + (r-1)*gapY. Choose minimum abs(log(r/c)), breaking numerical ties
(within 1e-12) by fewer cells r*c, then smaller c. Square means similar row and
column counts, NOT square pixel bounds. For 10 cards of 220x64 with gaps 50,
the default is 4 rows x 3 columns (760x406), not 5 rows x 2 columns (490x520).
`columns` fixes c instead of searching.
Cell centers are `(maxW/2 + column*(maxW+gapX), maxH/2 + row*(maxH+gapY))`.
Affine-normalize original box centers independently along each axis from their
min/max into the grid-center range; a collapsed axis maps to its midpoint.
Rectangular Hungarian assignment minimizes the **total squared Euclidean distance**
from these targets to distinct cells. It is not greedy or independent rounding.
Input-order rows and row-major cells give deterministic tie-breaking. Original-size
cards are centered inside their assigned max-size cells; empty cells are allowed.

Defaults: gapX/gapY 50, occupancy 1. Gaps are finite 0..1e6; occupancy is 0.1..1;
columns is an integer 1..M (absolute maximum 600). Limits: 60 nodes, 300 edges,
1200 cells after row rounding. Complexity is O(N²*c*r), with no dependencies.
Empty input gives zero bounds. Actual output bounds enclose occupied cards, not
unused cells, so may be smaller than W/H. Lower occupancy allows more empty cells;
large size differences waste space. This favors a square grid and positional
similarity, **not** ACA ordering, topology, edge length, or readable edges.
Routes are rebuilt as straight border-clipped segments preserving edge identities:
they may cross cards and each other. No box overlap is not a readability guarantee.
If needed, try `svg.routeEdges` separately and inspect crossings; do not describe
this baseline as obstacle-avoiding.

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
- **`svg.theme({ name?, tones?, colors?, unit? })`** → `{ ink, note, faint, line, bg, tone, space, toneNames }`. One palette and one spacing scale for the whole drawing, addressed by role rather than by hex code. `t.tone("accent")` returns `{ fill, stroke, text }` together — the three colours a card always needs at once, so text never ends up grey on grey — and spreads straight onto a shape: `<rect {...box} {...t.tone("accent")}/>`. `t.space(2)` is the 8-point scale, `t.ink`/`t.note`/`t.faint` the three text weights. Palettes: `paper` (light), `slate` (dark), `warm`, and `figjam` — Figma's published whiteboard palette, taken verbatim from their colour reference, with sticky tints, saturated shape presets (`teal`, `violet`, `pink`, `orange`, `black`) and Charcoal `#1E1E1E` text. Reach for `figjam` when the drawing is a board: stickies, a retro, a workshop map. `t.font` and `t.size` (title/label/note/tick) come with the palette, so the root `<svg>` and `measureText` agree on the font. Override one value with `tones: { accent: { fill: "#123456" } }` without restating the rest.
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

**Take colours from `svg.theme`, not from taste.** A drawing written by hand accumulates two dozen hex codes that differ by a digit, and no two drawings match. One `const t = theme({})` at the top gives tones by role and spacing from the 8-point scale; switching `name: "slate"` restyles the whole picture on one line, because nothing downstream knows a colour literal.

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

## Experimental graph layout helpers

Compute geometry **once in a tool/job**, then save its JSON or finished SVG. Do not run engines inside `svg tsx`: rendering runs again on refresh. Engines run in isolated subprocesses with hard deadlines; layouts do not guarantee crossing-free diagrams.

Input: `nodes: [{id,w,h,x?,y?}]`, `edges: [{id,from,to}]`. Coordinates are top-left; `x/y` are initial hints, not pins. Unique nonempty IDs, positive finite sizes. Simple graphs only (no loops or parallel undirected edges); maximum 500 nodes / 2000 edges. Output: `boxes: [{id,x,y,w,h}]`, `routes: [{id,from,to,points:[{x,y}]}]`, `bounds: {x,y,width,height}`, `metadata: {algorithm,engine,routing,warnings}`. Bounds include routes and can start at negative coordinates. Empty inputs need no engine.

| Helper | Actual engine / routes | Tuning and tradeoffs |
|---|---|---|
| `svg.layoutForce` | d3-force 3.0.0; **straight center-to-center** | `seed` (uint32, default 1), `iterations` (1–2000, default 300), `spacing` (0–1000, default 24). Repeatable for identical input order/options. Circular collision envelopes waste space for wide tables; no obstacle routing. Fixed 30s deadline. |
| `svg.layoutHola` | hola-graph 0.1.5 / HOLA; **native orthogonal** | `timeoutMs` (default 30000). Human-like orthogonal placement; expensive pipeline, possible native failures. No invented seed/direction knobs. |
| `svg.layoutCompact` | IMCS 1.0.6 `UNIVERSAL`; **native orthogonal** | `timeoutMs` (default 30000). Compact rectangle-aware layout; GWT shims isolated from server. |
| `svg.layoutIncremental` | hola-graph `_core.ACALayout`; **straight center-to-center** | `timeoutMs` (default 30000). Real ACA aligns edges and avoids overlaps; not a full orthogonal router or persistent interactive editing session. |

```ts
const graph = {
  nodes: [{id:'users',w:240,h:64}, {id:'sessions',w:240,h:64}],
  edges: [{id:'sessions_user',from:'sessions',to:'users'}],
};
const geometry = await ctx.fns.svg.layoutForce({...graph,seed:42,iterations:400,spacing:32});
// Same graph works with layoutHola / layoutCompact / layoutIncremental.
// Render route points as polylines; never call routeEdges on native routes.
```

### Dependencies and licenses

- `bun install --cwd plugins/svg`: pinned d3-force **3.0.0** (**ISC**), npm notices and plugin lockfile. Its Bun worker uses plugin-local dependencies.
- HOLA / ACA: venv `~/.hyper/deps/svg/hola-graph-0.1.5`, `hola-graph==0.1.5`. Wrapper **MIT**, Adaptagrams **LGPL-2.1-or-later**. Preserve licenses and matching sources when redistributing; no native library is vendored here.
- Compact: full upstream checkout `~/.hyper/deps/svg/imcs_layoutengine`, revision `3bbcefdc5bf25be976f4379ec986bd1db05f47bc` (1.0.6). Preserve sources and full `imcs_layoutengine.COPYING`: **GPLv2-or-later with Classpath exception** (IMCS), **W3C liberal**, **GPLv2 with Classpath exception** (GWT-AWT). Unmodified dist JS runs separately, not vendored.

Python setup: `python3 -m venv ~/.hyper/deps/svg/hola-graph-0.1.5`, then its `bin/python -m pip install hola-graph==0.1.5`. Compact setup: clone `https://github.com/LUMII-Syslab/imcs_layoutengine.git` into the directory above, checkout the pinned revision, retain the complete checkout. Helpers never auto-download code, depend on `/tmp`, or substitute another algorithm when dependencies are missing.

Fixture `fixtures/layout-tables.json` preserves the original 12-table benchmark. Run `bun test plugins/svg/src/svg/layoutGraph.test.ts` with optional native engines installed. Tests cover empty/invalid graphs, finite geometry, identities, native orthogonality and force repeatability. One graph is not a general algorithm ranking.


## Human refinement after ACA layout

For small architecture or concept diagrams, use **ACA as a starting composition, then manually compact and align it**. This workflow was preferred in a Kubernetes concept-map comparison over both raw automatic output and the initial composition drawn from scratch. This is a practical preference from that example, not a universal ranking of layout algorithms.

1. Run `svg.layoutIncremental` on the actual nodes and edges. Keep the node/edge set unchanged when comparing alternatives.
2. Reserve invisible padding around visible cards during layout: pass larger node dimensions, then draw smaller cards at the returned centres. ACA can otherwise leave cards touching. Reclip straight connector endpoints to the visible borders.
3. Preserve useful adjacency and branches from ACA, identify the main concept, and manually move cards into compact rows and columns around it. Prefer a roughly square composition when it fits the content; do not merely shrink the entire drawing or round coordinates without checking collisions.
4. Keep the main concept visually prominent (for Kubernetes, Pod). Place related branches nearby, with consistent gaps and enough whitespace to distinguish groups. Preserve every intended relationship when rerouting.
5. Keep straight connections where readable; use orthogonal detours where they improve clarity. Slightly rounded bends are fine. Avoid shared segments that make independent relationships look joined. Label different relationship meanings rather than implying every edge is the same kind of flow.
6. Inspect the rendered picture, not just metrics. Check readable labels, gaps, crossings, ambiguous junctions, and excessive empty space. A collision-free result is not necessarily a good composition.
7. Describe the output honestly as **ACA-seeded, manually refined** when coordinates or routes were adjusted; do not call it native ACA output.

Card styling for this workflow: use a short horizontal coloured line below the title, rather than a vertical accent on the side. In the successful Kubernetes example, the manually refined result made Pod the obvious centre, kept branches easy to follow, and removed unnecessary empty space.


## Automatic coarse-grid compaction after ACA

`svg.compactLayout` is a dependency-free radial postprocessor, **not** the unrelated native `svg.layoutCompact` engine. It retains actual card sizes and ACA branches: 160 deterministic attraction steps toward the original center (or `focusId`) apply stronger pressure along the long axis, with 16 collision/order projection sweeps per step. Each pair keeps its original center order on both axes and its ACA-derived separating axis. Coarse snapping uses nearest grid targets constrained by those same orders and separations, with eight relaxation sweeps: no shelves, rows, or branch repacking. The square objective is soft; fixed branches can require a wide composition. Focus anchors attraction before final translation to origin; ties may spread, and exact angles, center alignment, topology, smaller area, or a square are not guaranteed.

```ts
const aca = await ctx.fns.svg.layoutIncremental({ nodes, edges });
const compact = await ctx.fns.svg.compactLayout({ layout: aca, gridSize: 50, gap: 32, focusId: 'Pod' });
// Render compact.boxes and compact.routes, never the old ACA routes.
```

Input boxes must have finite coordinates within ±1e9 and dimensions in (0, 1e6]; at most 300 uniquely identified routes with valid distinct endpoints. `gridSize` is an integer 1–1e6, `gap` is finite 0–1e6. Empty graphs work without an engine. The origin resets to zero; input bounds and route points are ignored. Output is `GraphLayoutResult`, with `algorithm: "radial-compaction"` and `routing: "straight"`: newly computed border-clipped segments, **not obstacle-avoiding paths**. Segments may cross cards or one another. For fixed-box orthogonal routing, call `svg.routeEdges` separately with clearance smaller than half the packing gap, preserve edge IDs/endpoints and label that routing honestly; crossings and shared lanes remain possible. Always inspect the picture.

Regression tests: `bun test plugins/svg/src/svg/compactLayout.test.ts`. The ACA-original and radial before/after fixture and SVG in `fixtures/radial-kubernetes.*` retain the same 10 cards (220×64), nine edges, and branches around Pod. `radial-kubernetes-routed.svg` demonstrates separate orthogonal routing. The old `compact-kubernetes.*` fixture remains as historical shelf output, not the current expected result. Straight-edge limitations and remaining whitespace are visible, not hidden.
