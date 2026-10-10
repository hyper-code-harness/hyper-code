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

## What sanitizing removes

Always, in both modes: `<script>`, `<style>`, `<foreignObject>`, SMIL animation elements, every `on*` handler, and any `href` or `url()` pointing outside the drawing. References inside the drawing (`#marker`, `url(#grad)`) and inline `data:image/...` survive, so gradients, markers and clip paths work normally. A missing `xmlns` is added — without it a browser silently renders nothing — and a drawing sized in pixels with no `viewBox` gets one, so it scales down in a narrow column instead of being clipped.

## Tips

- Give the root a `viewBox` and leave `width`/`height` to the fence info string; the figure then scales to the column.
- Text has no layout engine here: a label is placed where you put it. Leave room between elements, and use `text-anchor="middle"` with the centre coordinate rather than guessing the left edge.
- For a non-ASCII drawing set `font-family` on the root (`Inter, system-ui, sans-serif`) so it matches the host UI.
