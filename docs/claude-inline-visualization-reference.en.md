# Inline visualization tools: a practical reference

> **Source and scope:** [Conversation with Claude](https://claude.ai/chat/a789d207-3c39-410d-88ea-38196e4146f8). This is Claude’s English capability reference, not verbatim original instructions. Formatting restored from the visible response. Code examples have not been tested.


This document describes the inline visualization capability (`read_me` and `show_widget`) as it appears from the model side in a chat interface. It is written to help engineers build a similar feature (for example, in Hyper). It is not an instruction set and does not reproduce any system or developer prompt.

## How to read this document

Every section carries one of these labels:

| Label | Meaning |
|----|----|
| **Verified observation** | Something directly observed when calling the tools in this conversation, such as the shape of a tool result. |
| **Paraphrased capability description** | A restatement, in my own words, of documentation the tools returned. Wording, structure, and completeness differ from the source. |
| **Unverified implementation assumption** | My inference about how something probably works internally. Treat it as a hypothesis. |
| **Recommendation** | My suggestion for your own implementation. It does not describe how the original system works. |

### What was omitted, and why

- **No verbatim excerpts are included.** The `read_me` tool returns detailed design documentation. I could not confirm that it is cleared for verbatim redistribution, so nothing here is labeled “Verbatim shareable documentation”. Everything drawn from it is paraphrased and abridged.
- **Hidden system and developer instructions are excluded**, including any guidance about when the model should choose this tool over others. None of it is reconstructed here.
- **Exact CSS definitions, full color tables, and internal schemas beyond the visible parameters are not reproduced.** Where I describe what a class or variable does, that is a functional description, not its definition.

------------------------------------------------------------------------

## 1. Architecture at a glance

**Paraphrased capability description.** There are two tools:

- `read_me` returns text guidance: the design system, available CSS variables and classes, layout rules, and examples for the requested modules. It renders nothing. The model is expected to call it before its first `show_widget` call.
- `show_widget` takes a string of SVG or HTML and renders it inline in the conversation, inside a card, below or between the model’s prose.

**Verified observation.** The `show_widget` result returned to the model is a short confirmation that the content was rendered and shown to the user. It contains no screenshot, no layout measurements, and no error report. **The model never sees the rendered output.** All sizing and overlap checks happen arithmetically before the call.

**Paraphrased capability description.** A core principle is that explanatory prose belongs in the normal chat response, outside the tool. The widget should contain only the visual itself.

------------------------------------------------------------------------

## 2. Modules

**Paraphrased capability description.** `read_me` accepts one or more of the following module names. Each one loads guidance for a category of output.

| Module | Purpose |
|----|----|
| `diagram` | SVG diagrams. Three kinds: flowcharts (steps and decisions), structural diagrams (containment, “what lives inside what”), and illustrative diagrams (visual metaphors that build intuition for a mechanism). Also covers when to use Mermaid instead. |
| `mockup` | UI mockups: cards, forms, option comparisons, data records, contained screens. |
| `interactive` | Explainers with live controls such as sliders, toggles, and readouts. |
| `chart` | Data charts with Chart.js, and geographic choropleths with D3 and real topology files. |
| `data_viz` | A design layer for charts: choosing the right form (sometimes a stat tile or table instead of a chart), assigning color by role, mark styling, and legends. |
| `art` | Illustration and generative art in SVG, with looser color rules. |
| `elicitation` | Structured forms for collecting parameters from the user. The host wires selection, file upload, and submission, and the answers return to the model as the user’s next message. |

------------------------------------------------------------------------

## 3. Tool parameter contracts

**Paraphrased capability description**, based on the parameters visible in the tool interface. Only fields I could observe are listed. I am not asserting that these are complete schemas.

### `read_me`

| Parameter | Observed meaning |
|----|----|
| `modules` | A list of module names from section 2. Several can be requested in one call. |
| `platform` | The target client: `mobile`, `desktop`, or `unknown`. The tool’s description says the default is `unknown`, which means desktop sizing. `mobile` adjusts guidance for a narrow viewport. |

Returns: text guidance.

### `show_widget`

| Parameter | Observed meaning |
|----|----|
| `widget_code` | SVG or HTML source. If it starts with `<svg`, it is treated as SVG. Otherwise it is an HTML fragment with no `DOCTYPE`, `<html>`, `<head>`, or `<body>`. |
| `title` | A short, specific snake_case identifier for the visual. It is also used as the download filename, so it should contain no spaces. |
| `loading_messages` | One to four short messages shown while the visual renders. For serious topics they should stay plain and descriptive. |

Returns: a confirmation string only (see the verified observation in section 1).

------------------------------------------------------------------------

## 4. Choosing an output form

**Paraphrased capability description.**

| Use | When |
|----|----|
| **Static SVG** | Flowcharts, structural diagrams, and illustrative diagrams with nothing to operate. One `<svg>` per call. Roughly four or five nodes per diagram; split larger subjects into several diagrams with prose between them. |
| **HTML** (optionally with inline SVG) | Anything with controls: sliders, toggles, steppers, mockups, calculators. Cyclic processes such as an event loop should be a stepper, not a ring drawn in SVG, because rectangular collision checks do not work on a circle. |
| **Mermaid** (inside HTML) | Entity-relationship and class diagrams only. These are text-layout problems that hand-placed SVG handles poorly. |
| **Chart.js** (inside HTML) | Charts of data. Canvas cannot resolve CSS variables, so chart colors are literal hex values. |
| **D3 + TopoJSON** (inside HTML) | Choropleth maps, using real topology fetched from an allowed CDN. Hand-drawn or invented coordinates are not acceptable. |

**Paraphrased capability description.** For diagrams, the intent matters more than the subject: someone who wants to *document* a system needs a reference diagram (labelled boxes and arrows), while someone who wants to *understand* it is better served by an illustrative metaphor.

------------------------------------------------------------------------

## 5. SVG conventions

### Canvas

**Paraphrased capability description.**

- The root element uses `width="100%"` with a viewBox exactly 680 units wide. This keeps SVG units roughly equal to CSS pixels in the widget container, so the text-size math holds. Narrow content should be centered within the 680-wide box, not given a narrower viewBox.
- The safe area is about x = 40 to 640, with about 40 units of padding top and bottom. Negative coordinates should not be used.
- The background is transparent and the SVG is not wrapped in a colored container, because the host supplies the card.
- `<defs>` holds an arrow marker whose head uses `context-stroke`, so it takes the color of whatever line it is attached to.

### Host-provided SVG classes

**Paraphrased capability description.** These classes are preloaded by the host. The descriptions are functional; I am not reproducing their CSS.

| Class | What it does |
|----|----|
| `t` | 14px regular text in the primary text color. |
| `ts` | 12px text in the secondary color, for subtitles and small labels. |
| `th` | 14px medium-weight text, for titles. |
| `box` | A neutral, theme-aware rectangle style. |
| `node` | A clickable group with a pointer cursor and hover feedback. |
| `arr` | A thin connector line style for arrows. |
| `leader` | A thin dashed line for callout leaders. |
| `c-{ramp}` | A color ramp applied to a group or shape: `c-purple`, `c-teal`, `c-coral`, `c-pink`, `c-gray`, `c-blue`, `c-green`, `c-amber`, `c-red`. Sets fill and stroke, adjusts child text classes, and switches automatically in dark mode. |

**Paraphrased capability description.** Practical notes on these classes:

- Every `<text>` element should carry `t`, `ts`, or `th`. Unclassed text is a common source of dark-mode failures.
- `c-{ramp}` styles only its direct children. A shape nested one group deeper loses its fill. Put the class on the innermost group that holds the shapes, or on the shape itself. It does not apply to `<path>`.
- Color should encode category or meaning, not sequence. Two or three ramps per diagram is the norm, with gray for neutral nodes. Blue, green, amber, and red carry strong informational, success, warning, and error connotations, so general categories tend to use purple, teal, coral, or pink.
- Text on a colored fill uses darker stops from the same ramp. A title and its subtitle use two different stops.

### Theme variables

**Paraphrased capability description.** The host defines CSS custom properties that switch automatically between light and dark mode. The commonly used ones are:

| Group | Variables |
|----|----|
| Surfaces | `--surface-0` (page), `--surface-1` (card), `--surface-2` (raised) |
| Role backgrounds | `--bg-accent`, `--bg-danger`, `--bg-success`, `--bg-warning` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, plus role colors `--text-accent`, `--text-danger`, `--text-success`, `--text-warning` |
| Borders | `--border`, `--border-strong`, `--border-stronger`, plus role borders |
| Typography | `--font-sans`, `--font-voice` (serif), `--font-mono` |
| Layout | `--radius`, plus spacing scales such as `--pad-*` and `--gap-*` |

**Paraphrased capability description.** HTML should use these variables for every color. A hardcoded dark gray, for example, becomes unreadable on a dark background. The documentation describes dark mode as driven by a `data-mode` attribute on the widget root, with the operating-system color-scheme preference as a fallback.

### Visual style constraints

**Paraphrased capability description.**

- Flat surfaces: no gradients, drop shadows, blur, or glow. Narrow exceptions exist for illustrative diagrams showing a continuous physical property, and for elicitation forms.
- Two font weights (400 and 500), no text smaller than 11px, sentence case for all labels.
- No emoji. Icons come from a preloaded Tabler outline icon font.
- Thin strokes (around 0.5px) for diagram borders.
- No code comments in widget source, because they waste tokens and can interfere with streaming.

------------------------------------------------------------------------

## 6. Layout technique

**Paraphrased capability description**, with my own explanations. Because the model cannot see the result, layout is computed by hand before the call.

### Text sizing

SVG text never wraps. Estimate widths before placing text:

- About 8px per Latin character at 14px, and about 7px at 12px.
- The documentation includes a calibration table measuring real strings. For example, a 12-character Japanese label measures about 181px at 14px, so CJK text is much wider.
- Formulas, subscripts, and special symbols need 30 to 50 percent extra room.
- My own practice for Cyrillic is to use similar per-character estimates with extra margin. That is my extrapolation, not a documented figure.

A useful box-width rule: `width = max(title_chars × 8, subtitle_chars × 7) + 24`. Subtitles should stay at roughly five words or fewer. If a label does not fit, shorten it rather than adding a second line.

### Boxes and vertical placement

- Single-line nodes are 44px tall; title-plus-subtitle nodes are 56px.
- Text uses `dominant-baseline="central"` with `y` at the vertical center of its row. Without it, `y` is the baseline and the text sits visibly high.

### Packing a row

Add up box widths plus gaps before placing anything. Four 160px boxes with 20px gaps need 700px, which does not fit the 600px safe width; shrink the boxes, cut subtitles, or wrap to a second row. Keep at least 20px between adjacent boxes in a row.

### Arrows

- Before writing each line, check it against every box other than its source and target. If it would cross one, route around it with an L-shaped `<path>`.
- Every connector `<path>` or `<polyline>` needs `fill="none"`. Without it, the default black fill turns a curve into a solid shape.
- Lines stop at the edge of the component, with a small gap before the arrowhead. They should not run underneath a fill and rely on the fill to hide them.
- Arrow labels are usually unnecessary. If a label is needed, place it in clear space, not on the line.

### Overlap and bounds check

- Compare bounding boxes pairwise. The only acceptable overlaps are deliberate ones: a label inside its own box, an arrowhead touching its target, a highlight behind its subject.
- `text-anchor="end"` extends text leftward from `x`, which is the easiest way to clip past the left edge.
- Set the viewBox height to the lowest element’s bottom edge plus roughly 20 to 40 units of padding.

------------------------------------------------------------------------

## 7. HTML and JavaScript interaction

**Paraphrased capability description.**

- **Plain JavaScript works** inside HTML widgets: event listeners, DOM updates, and CSS transitions.
- **`sendPrompt(text)`** is a global function that sends a message into the chat as if the user typed it. It suits actions that benefit from the model’s reasoning (follow-up questions, drill-downs). Filtering, sorting, and calculations should stay in local JavaScript.
- **Links**: ordinary `<a href>` links are intercepted and opened through the host’s link-confirmation dialog. `openLink(url)` does the same programmatically.
- **Form controls** such as inputs, buttons, and range sliders come pre-styled.
- **Input validation**: any widget that collects input should validate it in its handler and show an inline error rather than proceeding with empty or invalid input.
- **Displayed numbers** should be rounded explicitly, since floating-point artifacts otherwise leak onto the screen.
- **No `position: fixed`.** The frame sizes itself to in-flow content, so fixed elements collapse it. A modal is mocked up inside a normal-flow container instead.
- **No fullscreen.** The fullscreen API is unavailable. An “expand” control should toggle a taller in-flow layout synchronously.
- **No hidden sections during streaming** (tabs, carousels, `display: none`), because hidden content streams invisibly. Steppers driven by script after streaming are fine.
- **Animation** is limited to `transform` and `opacity`, short loops, and is wrapped in a `prefers-reduced-motion: no-preference` media query.

------------------------------------------------------------------------

## 8. Libraries and network

**Paraphrased capability description.**

- External resources load only from an allowlist enforced by Content Security Policy: `cdnjs.cloudflare.com`, `esm.sh`, `cdn.jsdelivr.net`, `unpkg.com`, `fonts.googleapis.com`, and `fonts.gstatic.com`. Requests to other origins fail silently. Data fetches such as topology files are limited to the first four; the Google Fonts hosts serve stylesheets and fonts only.
- Libraries are loaded as UMD builds via `<script src>`, and that tag must come before any inline script that uses the library’s global.
- Documented libraries: Chart.js (UMD from cdnjs), D3 with TopoJSON for maps, and Mermaid imported as an ES module from esm.sh.
- The Tabler outline icon font is preloaded. Only outline icons are available; filled variants render blank.

------------------------------------------------------------------------

## 9. Rendering lifecycle

**Paraphrased capability description.**

1.  The model calls `read_me` for the modules it needs.
2.  The model calls `show_widget`. The code streams in token by token and the DOM updates progressively.
3.  Scripts execute only after streaming completes.
4.  The frame’s height adjusts to fit the content.
5.  SVG output is wrapped in a card by the host.
6.  The model receives a confirmation string (**Verified observation**).

Streaming has practical consequences for code order: put a short `<style>` block first, then content, then `<script>` last. Prefer inline `style` attributes so controls look correct mid-stream. Gradients and shadows can flicker during progressive DOM updates, which is one reason for the flat style.

**Unverified implementation assumption.** The documentation refers to the widget’s iframe and to CSP enforcement, so I assume a sandboxed frame with a restrictive policy and a bridge carrying `sendPrompt`, `openLink`, height changes, and the theme mode between frame and host. I have not observed the sandbox attributes, the message protocol, or how the theme is injected.

------------------------------------------------------------------------

## 10. Accessibility

**Paraphrased capability description.**

- **SVG**: the root `<svg>` carries `role="img"`, with `<title>` and `<desc>` as its first children.
- **HTML**: begin with a visually hidden heading (the documentation uses an `sr-only` class) containing a one-sentence summary of the visualization.
- **Canvas charts**: every `<canvas>` has `role="img"`, a descriptive `aria-label`, and fallback text between its tags.
- **Icons**: decorative icons get `aria-hidden="true"`; icon-only buttons get an `aria-label`.
- **Color**: never the only signal. Pair it with a label, pattern, dash style, or shape.
- **Motion**: honor `prefers-reduced-motion`.
- **Contrast**: every element must stay readable on both a light and a near-black background.

------------------------------------------------------------------------

## 11. Complete examples

Each example below is complete as written and assumes the host classes, variables, and globals described above. I wrote these examples; they are not excerpts from the documentation.

### 11.1 Static SVG flowchart

Layout check: three 160px boxes with two 60px gaps span exactly x = 40 to 640. The longest subtitle (“Renders the widget”, 18 characters) needs about 126px of the 136px usable width. Arrows leave a 10px gap at each end. The lowest edge is at y = 96, so the height is 136.



svg

```svg
<svg width="100%" viewBox="0 0 680 136" role="img">
  <title>Widget pipeline</title>
  <desc>The model writes SVG, the host validates it, and an iframe renders the widget.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <g class="node c-purple" onclick="sendPrompt('How does the model write the SVG?')">
    <rect x="40" y="40" width="160" height="56" rx="8" stroke-width="0.5"/>
    <text class="th" x="120" y="58" text-anchor="middle" dominant-baseline="central">Model</text>
    <text class="ts" x="120" y="78" text-anchor="middle" dominant-baseline="central">Writes the SVG</text>
  </g>
  <g class="node c-teal" onclick="sendPrompt('What does the host validate?')">
    <rect x="260" y="40" width="160" height="56" rx="8" stroke-width="0.5"/>
    <text class="th" x="340" y="58" text-anchor="middle" dominant-baseline="central">Host</text>
    <text class="ts" x="340" y="78" text-anchor="middle" dominant-baseline="central">Validates the code</text>
  </g>
  <g class="node c-teal" onclick="sendPrompt('How does the iframe render the widget?')">
    <rect x="480" y="40" width="160" height="56" rx="8" stroke-width="0.5"/>
    <text class="th" x="560" y="58" text-anchor="middle" dominant-baseline="central">Iframe</text>
    <text class="ts" x="560" y="78" text-anchor="middle" dominant-baseline="central">Renders the widget</text>
  </g>
  <line x1="210" y1="68" x2="250" y2="68" class="arr" marker-end="url(#arrow)"/>
  <line x1="430" y1="68" x2="470" y2="68" class="arr" marker-end="url(#arrow)"/>
</svg>
```

### 11.2 Interactive HTML explainer

A slider updates a readout locally. The button hands a follow-up to the model through `sendPrompt`. Displayed values are rounded. At 7 percent over 20 years, 1,000 grows to about 3,870.



html

```html
<h2 class="sr-only">Calculator showing how 1,000 grows at 7 percent annual interest over a chosen number of years.</h2>
<div style="display:flex;align-items:center;gap:12px;margin:0 0 1rem">
  <label for="years" style="font-size:14px;color:var(--text-secondary)">Years</label>
  <input type="range" id="years" min="1" max="40" step="1" value="20" style="flex:1">
  <span id="years-out" style="font-size:14px;font-weight:500;min-width:24px;color:var(--text-primary)">20</span>
</div>
<div style="display:flex;align-items:baseline;gap:8px;margin:0 0 1rem">
  <span style="font-size:14px;color:var(--text-secondary)">1,000 at 7% grows to</span>
  <span id="result" style="font-size:24px;font-weight:500;color:var(--text-primary)">3,870</span>
</div>
<button type="button" id="ask">Explain this result ↗</button>
<script>
const slider = document.getElementById('years');
function update() {
  const n = Number(slider.value);
  document.getElementById('years-out').textContent = n;
  document.getElementById('result').textContent = Math.round(1000 * Math.pow(1.07, n)).toLocaleString('en-US');
}
slider.addEventListener('input', update);
document.getElementById('ask').addEventListener('click', function () {
  sendPrompt('Explain how 1,000 grows at 7% over ' + slider.value + ' years');
});
update();
</script>
```

### 11.3 Chart.js bar chart

One series, so no legend; the color is a literal hex value because canvas cannot read CSS variables. Height is set only on the wrapper.



html

```html
<div style="position:relative;width:100%;height:260px">
  <canvas id="quarterly-revenue" role="img" aria-label="Bar chart of quarterly revenue in millions: Q1 12, Q2 19, Q3 8, Q4 15">Quarterly revenue in millions: Q1 12, Q2 19, Q3 8, Q4 15.</canvas>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
new Chart(document.getElementById('quarterly-revenue'), {
  type: 'bar',
  data: {
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    datasets: [{ label: 'Revenue', data: [12, 19, 8, 15], backgroundColor: '#2a78d6', borderRadius: 4, maxBarThickness: 24 }]
  },
  options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
});
</script>
```

------------------------------------------------------------------------

## 12. Known limitations

**Verified observation**

- The model receives no visual feedback, so layout errors (clipped text, overlaps, arrows through boxes) are not detected by the model.

**Paraphrased capability description**

- One `<svg>` element per `show_widget` call.
- Width is fixed at a 680-unit viewBox; the frame is narrow, so dense layouts break.
- No `position: fixed`, no fullscreen, no nested scrolling.
- Network access is limited to the CDN allowlist in section 8.
- Scripts run only after streaming completes.
- Canvas-based charts cannot use CSS variables.
- No filled icons, no emoji, no text below 11px.

------------------------------------------------------------------------

## 13. Building a similar feature: recommendations

Everything in this section is a **Recommendation** for your own implementation. It does not describe the original system.

1.  **Keep the two-tool split.** A guidance tool that returns rules per module keeps the generation prompt small and lets you version the design system independently.
2.  **Isolate widgets.** Render each widget in an iframe with `sandbox="allow-scripts"` and without `allow-same-origin`, served via `srcdoc` or a separate origin, with a CSP that mirrors your CDN allowlist. The widget then has no access to your cookies, storage, or DOM.
3.  **Bridge events explicitly.** Implement `sendPrompt` and `openLink` inside the frame as thin wrappers over `parent.postMessage`. On the host, check that `event.source` is the expected frame, validate the message type and length, rate-limit, and display any sent prompt visibly as the user’s message.
4.  **Auto-size the frame.** Run a `ResizeObserver` inside the frame and post the content height to the host.
5.  **Own the theme.** Define the CSS variables and SVG classes in a host-injected stylesheet, set a mode attribute on the frame root when you create it, and update it when the user switches theme. Document the class behaviors your model may rely on, including the direct-child behavior of ramp classes if you copy that design.
6.  **Stream safely.** Apply partial markup incrementally, but insert and execute `<script>` elements only after the stream ends.
7.  **Close the feedback loop.** This is the biggest improvement available over a write-only tool. After rendering, measure `<text>` and `<rect>` elements with `getBBox()`, detect content outside the viewBox, text colliding with unrelated shapes, and connectors crossing non-endpoint boxes, then return that report as the tool result so the model can correct the visual.
8.  **Lint before rendering.** Reject or warn on unclassed `<text>`, connector paths without `fill="none"`, more than one `<svg>`, disallowed origins, and `position: fixed`.
