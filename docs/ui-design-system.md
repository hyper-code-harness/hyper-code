# UI design system

Hyper-code2 owns its UI component and theme layer. Tailwind supplies utilities and the Typography plugin; there is no external component framework.

## Principles

1. **The base is four colours: white, grey, blue and black.**
   - **White** — the document: the page you read and write on.
   - **Grey** — eight shades for chrome, surfaces, lines and quiet text (chrome → chat → document).
   - **Blue** — four shades for what is interactive or alive: links, selection, the current item, focus,
     "running", info.
   - **Black (ink)** — body text, the person's message bubble and the primary button: the strongest contrast on the
     page, it marks "mine" and "do this".

   Hierarchy comes from these four and from weight and size; nothing is coloured for decoration.
2. **A super accent — only when it matters.** One hue outside the base four, kept for the one
   thing that needs the person now (an agent waiting for an answer, an unread mention, the irreversible action in a
   dialog). If it is in two places on a screen, one of them should not be. Semantic states (success, warning,
   danger) are rare too and appear only on the element they describe.
   **Only ink and blue fill; every other colour is a line.** The super accent, success, warning and danger never
   paint a background: they colour the outline, the text and the icon of the element, which stays on white —
   the danger button is white with a red outline and red text, the badge is a coloured outline, the danger card and
   the error toast have a coloured border. Fills are kept for ink (mine / do this) and pale blue (selected). The one
   exception is the 8 px state dot — a mark, not a background.
3. **Interaction: rails are buttons, grey on hover, blue for state, a chevron off the rail.**
   - *Hover* on any button, row, tab or tool cell is a **grey backing** (`hover`) and the icon or text going from grey
     to ink. Never blue — the pointer crosses headers and bars all the time; blue there would flicker and stop
     meaning anything. The primary (ink) button lightens a little; a destructive one turns red.
   - *Blue* is for **state**, not for hover: selected / current / open (a light-blue backing and a blue icon), keyboard
     focus (a blue ring), "running", and links in text (always blue; underline on hover).
   - *Links and focus are both blue, but different shades of the blue scale*, so they never read as one thing: a link
     is a deep, readable blue for text on white; focus is a brighter, lighter blue ring that shows on any surface
     (white, grey or a black button) without looking like a link. Selected is the palest blue (a backing), running a
     mid blue.
   - *Focus on an edge, not a ring, for fields that span a pane* — the chat composer, the menu search: focus turns
     only the line that separates the field from the rest (the composer's top line, the search's bottom line)
     bright blue. A ring around such a field would cut the pane's rounded corners. Small controls (buttons, inputs
     inside a form) keep the ring.
   - *On a rail everything is a button.* Rails (the Dock, the folded canvas, header rows) have their own background
     colour (the chrome grey), and that background is the signal: whatever sits on it can be pressed. Rail controls
     need no extra marks.
   - *Off the rail, a chevron is the hint.* A control that opens a panel or a menu where it does not sit on a rail —
     or where it could read as plain text, like a title — carries a chevron ⌄ next to its label (the chat header:
     icon + name + ⌄); open, the chevron points up and the group is light blue. On a rail the chevron is optional.
4. **Black is "mine" and "do this".** Ink on white is the strongest contrast on the page, so it is spent on two
   things only, and the eye learns both at once:
   - *The person's own words* — the message bubble is ink with white text, on the right. The agent's answer has no
     bubble at all: it is text right on the page. So the conversation reads as "my short black notes, its long
     answers", and you find your last question at a glance.
   - *The one main action* — the primary button (send, Save, Create, Confirm) is ink with white text. One per view:
     if a form has two black buttons, one of them is secondary (white with a grey line) or ghost. Send and stop in
     the composer are the same ink circle; stop carries the blue "running" arc.
   Black is not used for anything else that could be mistaken for these two: no black badges, chips, headers or
   decorative blocks. A destructive action is not black but red (danger), and only in the place where it happens.
5. **Typography: few sizes; hierarchy by weight and shade (like Emacs faces).**
   - *Three sizes.* 13 px — the interface (menus, headers, rows, buttons); 14 px — what is read (messages, Markdown,
     documents); 11 px — the small print (time, ids, hints, counts). Larger only for headings inside documents.
   - *Weight and shade, not size.* 400 regular, 500 for names and pane titles, bold only in documents. Importance is
     the ink shade: body `ink`, secondary `ink-muted`, quiet `ink-faint`.
   - *Monospace only for the literal* — code, ids, paths, commands, keys; numbers in columns use tabular figures.
     Never monospace for titles or decoration.
   - *Section captions in panes* are like VS Code's EXPLORER: 11 px, caps, letter-spaced, grey — in the chrome only,
     never in documents.
   - *Line height:* 20 px for interface rows (an even grid), 1.6 for reading text.
6. **Spacing: one 4 px grid; dense, like an editor.**
   - *Steps 4 / 8 / 12 / 16 / 24* — no other values.
   - *Heights 24 / 28 / 32 / 40:* small control 24, control and list row 28, header 32, rail 40.
   - *Inside a row 8, at a pane edge 12;* icons stand in one 20 px column so labels start on one line.
   - *Panes are divided by lines, not by air:* spacing groups things inside a pane; between panes there is a 1 px line,
     not a gap.
7. **Icons: one set, one stroke (like VS Code codicons).**
   - *Phosphor regular, four sizes:* 16 in rows and buttons, 14 in tabs and small buttons, 12 next to small print,
     larger only in empty states.
   - *Colour follows state, not meaning:* grey at rest, ink on hover, blue when selected, red for a destructive action.
     No icons coloured for decoration.
   - *Icon without a label only on rails and in headers*, always with a tooltip; elsewhere an icon goes with its
     label.
   - *One meaning — one icon*, kept as a vocabulary: folder-open = working folder, square-half = canvas,
     terminal = bash, brackets-curly = eval, pencil-simple = edit, magnifying-glass = search, sidebar-simple = panel,
     gear-six = settings, at = mention, sparkle = agent, push-pin = pin, trash = delete.
   - *Badges* sit in the icon's top-right corner with a ring in the surface colour, so they never cut the glyph.
   - *Buttons look one size.* All are 28 px (24 small); an outlined button's line is `border-control` so its edge weighs about as
     much as a filled ink button's — a lighter line makes it look a pixel smaller.
8. **The server draws.** A widget is a function that returns HTML; behaviour is htmx attributes and native HTML
   (popover, details, dialog). Client JS only where nothing else works: dragging, keys, the clipboard.
9. **Meaning, not looks.** Props say what a thing is (`tone: "danger"`, `state: "running"`, `size: "sm"`), never how it
   looks; no classes passed in from outside.
10. **Tokens by name, composed by mixins.** Colours, sizes, radii, the shadow and type come from variables; a theme
    changes only the variables. Every step a principle allows has a name by meaning:
    radius `frame / item / window / round`, shadow `raised`, rule `rule / rule-control / focus-width`, text `ui / read / small` (`--w-text-*`), line
    `ui / read`, weight `normal / strong`, ink `fg / muted / faint`, line `around / top / bottom / start / end / between`, `caption`, space `s1…s6` plus the places `inside` (8) and
    `edge` (12), height `control-xs / control-sm / control / control-lg / row / header / rail` (20/24/28/32/28/32/40),
    icon `icon-small / icon-compact / icon / icon-large / icon-hero` (12/14/16/20/24), `dot`, `dot-small`, `mark`.
    Inside widgets a size is a token too; a raw number is left only for optical offsets and content widths. Pages arrange widgets with `w.box({ mix })` / `w.mix({ mixes })`: a mixin (`types.w.Mixin`) is a plain
    object of those names, so mixins merge in code (`[caption, { gap: "inside" }]`, later wins) and become `wx-*`
    classes — the `wx-` prefix never clashes with a page's own classes. No inline style with numbers; colours, hover
    and states are not mixins, they stay inside the widgets. A test (`src/w/w.test.ts`) fails on spacing off the grid,
    a third weight, an unnamed radius or a raw shadow.
11. **One action shape.** Everything clickable takes one `Action` with exactly one kind.
12. **Surfaces and depth: a flat frame, four levels, three radii, one shadow.**
   - *0 · Frame* — the window's panes: rails, side panel, canvas, chat and their headers. Square corners, no shadow;
     panes stand edge to edge, ruled by 1 px lines, told apart only by grey (grey chrome, white documents).
   - *1 · Inside a pane* — whatever lies in any pane: cards, buttons, fields, rows, bubbles, tool strips. Radius 6,
     a 1 px line, no shadow. The canvas is not special: it is a pane, its document is level 1.
   - *2 · Pops up over a pane* — menu, popover, toast, tooltip. Radius 6, a line and the shadow: it differs from a
     card by the shadow, not by its corners.
   - *3 · Over the whole window* — dialog and the floating chat. Radius 12 and the same shadow; the dialog also dims
     the window below.
   - *Radii 0 / 6 / 12, plus round* (`--w-radius-frame`, `--w-radius-item`, `--w-radius-window`, `--w-radius-round`). Round is a shape, not a
     step: avatar, dot, counter, send button. No other values.
   - *One shadow* (`--w-shadow-raised`): none or this one. Height is told by the radius and the backdrop, not by a bigger
     shadow.
   - *Dark theme:* a shadow barely shows on dark, so height is told by lightness — the higher, the lighter the
     background, plus the line.
13. **Lines: one rule, between things; colour and 2 px mean a state.**
   - *One neutral line:* `--w-rule` = 1 px `--w-border`. It divides panes and outlines what lies inside one.
     The only other neutral edge is `--w-border-control` on an outlined button or field, so it weighs as much
     as a filled ink one.
   - *Between, not around:* two neighbours share one line, never two; rows inside a list or card are divided by a
     line, they get no frames of their own (`line: "between"`).
   - *2 px is a state* (`--w-focus-width`): the focus ring, the open tab's underline, the loading arc. Never decoration.
   - *A coloured line is a meaning:* focus and selection blue, danger/warning/success on the element itself
     (principle 1). Grey on hover, also for lines: the split handle darkens to `border-control`, it does not turn blue.
   - Exceptions on purpose: the key cap's 2 px bottom, the markdown quote bar, the floating chat's resize corner.
14. **Caps: only the section caption.** Spaced capitals are one role, `caption` — 11 px, weight 500, quiet grey,
   `--w-caps-spacing` (.06 em): a short name of a group in the chrome, like EXPLORER in VS Code, one to three words,
   never clickable. No caps in buttons, pane titles, badges, documents or messages; a card header is a caption.
15. **No spare colours: 19 colours, each named by its meaning.** There is no numbered scale (no grey 1–12, no blue
   1–12): a colour exists only because a meaning needs it, and two meanings that look the same share one name
   (`live` is running and info; `link` is links and the selected item's text; code blocks sit on `surface-chat`).
   - surfaces: `surface-document`, `surface-raised` (what pops up; lighter in dark, principle 12), `surface-chat`,
     `surface-chrome`, `hover`;
   - lines: `border`, `border-control`;
   - ink: `ink`, `ink-muted`, `ink-faint`, `on-ink`;
   - blue, for state: `selected`, `focus`, `live`, `link`;
   - accent and states: `super`, `success`, `warning`, `danger`.

   A theme sets exactly these 19; a widget reads exactly these. A new colour comes only with a new meaning. The lint
   fails on a numbered step, on more than 19 colours and on a colour no widget uses.
16. **Motion: quiet, short, and off when asked.** Two speeds: `--w-motion-fast` (.12 s) answers the pointer — a
   tooltip appearing, a chevron turning; `--w-motion-slow` (1.6 s) means "alive" — the pulsing dot, the skeleton
   shimmer. The loading arc turns at `--w-motion-spin`. One easing, `--w-ease`. Nothing slides or bounces for
   decoration; nothing moves that is not either answering the person or working. Under `prefers-reduced-motion`
   every animation and transition inside `[data-w-theme]` stops.
17. **States: one rule each.**
   - *Disabled:* shown, not hidden — `--w-disabled-opacity` (.4), no hover, no pointer; the same on buttons, icon
     buttons, rows, tool cells and rail items. Prefer explaining why (a tooltip) over a silent grey.
   - *Loading:* the spinner in place of the thing (`w.spinner` arc), or a skeleton of the shape to come. No
     full-page overlays, no "Loading…" text alone.
   - *Empty:* `w.empty` — a quiet 24 px icon, a short title, one hint and at most one action. A list with no rows
     draws it by itself.
   - *Error:* the same `w.empty` with tone danger — the icon and the title turn red, never a red fill; say what to do
     (Retry) and keep what was typed.
18. **One density, and plain words.**
   - *Density:* one, like an editor — 28 px controls and rows, 13 px text. No "comfortable" mode; a phone gets a
     different layout, not bigger widgets.
   - *Copy:* a button is a verb (Save, Delete chat — never OK or Submit); sentence case, no trailing full stop on
     labels, buttons and tooltips; a tooltip names the action in two or three words; a hint is one sentence; the
     interface speaks English (the person's messages keep their language). Numbers stay digits; time is relative
     ("2 min ago") with the exact time in the tooltip.
19. **Accessible by default.** Labels, focus, keyboard and a high-contrast theme are built in, not added later.
20. **One thing per file, and it is in the gallery.** Every widget is `w.<name>` and appears on `/rpc/w.gallery`; agents
    and plugins build their pages from the same set.

## Widget set `w.*`

The widget set lives in `src/w` (atomic design: tokens → atoms → molecules → organisms → templates, one cascade layer
per level in `src/w/$style_w.css`, then `w-mix` for page mixins). The older `procs.ui.*` components remain until pages
move over; the chat and side panel still render with them.

- Gallery: `/rpc/w.gallery` (`?theme=light|dark|contrast`) — colours, principles in action, surfaces and depth,
  then every widget; the ƒ button by its name opens its formula in a popover: the widgets it is made of and the tokens its rules read, by group
  (colour, type, space, size, shape). `w.anatomy({ name })` computes it from the source and the stylesheet.
- Tests: `src/w/w.test.ts` — actions, safe URLs, popovers, tabs, every gallery cell renders, mixins, a **principles
  lint** over the stylesheet, and no two files in `src/w` that differ only by letter case (macOS writes one over the
  other: a type is `Mixin.ts`, the function `mix.ts`).

### Tokens — names, not numbers

Every value a widget uses is one of these; a theme (`data-w-theme`) changes only the palette under them.

| group | tokens |
|---|---|
| colours | `surface-document` `surface-raised` `surface-chat` `surface-chrome` `hover` · `border` `border-control` · `ink` `ink-muted` `ink-faint` `on-ink` · `selected` `focus` `live` `link` · `super` `success` `warning` `danger` — 19, by meaning (principle 15) |
| type | `--w-text-ui` 13, `--w-text-read` 14, `--w-text-small` 11; `--w-line-ui` 20px, `--w-line-read` 1.6, `--w-line-small` 16px; `--w-mono` |
| space | `--w-s1` 4, `--w-s2` 8, `--w-s3` 12, `--w-s4` 16, `--w-s6` 24; places `--w-gap-inside` 8, `--w-gap-edge` 12; `--w-icon-col` 20 |
| heights | `--w-control-xs` 20, `--w-control-sm` 24, `--w-control` 28, `--w-control-lg` 32, `--w-row` 28, `--w-header` 32, `--w-rail` 40 |
| icons | `--w-icon-small` 12, `--w-icon-compact` 14, `--w-icon` 16, `--w-icon-large` 20, `--w-icon-hero` 24; `--w-dot` 8, `--w-dot-small` 6, `--w-mark` 16 |
| radii | `--w-radius-frame` 0, `--w-radius-item` 6, `--w-radius-window` 12, `--w-radius-round` |
| depth | `--w-shadow-raised` (the one shadow), `--w-backdrop` |
| lines | `--w-rule` (1px border), `--w-rule-control` (1px border-control), `--w-focus-width` 2px |
| caps | `--w-caps-spacing` .06em |
| widths | `--w-width-popup` 22rem (menu, toast), `--w-width-popup-min` 11rem, `--w-width-dialog` 24rem, `--w-width-label` 7rem, `--w-measure` 70ch (a reading line) |
| motion | `--w-motion-fast` .12s, `--w-motion-spin` .9s, `--w-motion-slow` 1.6s, `--w-ease` |
| layers | `--w-layer-mark` (a badge over its icon), `--w-layer-popup` (tooltip); menus, popovers and dialogs use the browser top layer |
| states | `--w-disabled-opacity` .4 |

Raw numbers remain only for optical offsets (the badge on an icon's corner, the running ring, the split handle's
hit area, the floating chat's grip); the lint lists them by name and fails on any other number, duration or z-index.

### Mixins — composing a page

A page arranges widgets with mixins, never inline style. A mixin (`types.w.Mixin`) is a plain object of the names
above; `w.mix({ mixes })` merges them left to right (later wins) into `wx-*` classes, `w.box({ mix, body, tag? })` wraps
HTML in a div with them. The `wx-` prefix never clashes with a page's own classes.

| field | values |
|---|---|
| `layout` | `stack` · `row` · `grid`; with `align`, `justify`, `wrap`, `grow`, `scroll` |
| `gap`, `pad`, `padX`, `padY` | `s1` `s2` `s3` `s4` `s6` `inside` `edge` |
| `text` · `weight` · `ink` | `ui` `read` `small` · `normal` `strong` · `base` `muted` `faint`; plus `mono`, `truncate` |
| `caption` | the one caps role: 11px, 500, quiet grey, spaced capitals |
| `line` | `around` `top` `bottom` `start` `end` `between` (one rule between children: horizontal in a stack, vertical in a row) |
| `radius` · `raised` | `frame` `item` `window` `round` · the one shadow |

```ts
const caption = { caption: true } as const;
w.box({ mix: { layout: "stack", gap: "inside" }, body:
    w.box({ mix: caption, body: "Open editors" }) +
    w.box({ mix: [{ layout: "row", gap: "inside", pad: "edge" }, { line: "top" }], body: buttons }) });
```

Not mixins, on purpose: colour, background, hover, selected, focus, 2px and the control line — meaning and state stay
inside widgets (principles 1, 3, 9, 13). Widgets themselves keep their own semantic classes and read tokens.

### Still open

- moving the chat and side panel from `procs.ui.*` / `ui-*` tokens onto `w.*`;
- mixins inside large widgets (card, message, plan) — today widgets keep their own semantic classes.

## Where design work lives

- `docs/ui-design-system.md` (this file) — the principles and the token / mixin reference; the source of truth.
- `src/w` — the widgets, the stylesheet and the tests; `/rpc/w.gallery` shows them.
- Project memory `notes/design-principles.md` — a short Russian mirror of the principles for discussion.
- Project memory `pages/*.html` — canvas drafts and proposals (surfaces and depth, typography, atoms…); a proposal
  moves into this file once agreed.

## Legacy app styles (`procs.ui.*`, `ui-*` tokens)

Application code does not use `procs.ui.*`; everything outside `src/procs/` draws with `w.*`. The
`procs-ui` rule of `code.quality` is an error for any reference to `ctx.fns.procs.ui` outside `src/procs/`,
an alias such as `const ui = ctx.fns.procs.ui` included (the call graph cannot see through an alias). Hand-written
`ui-button` classes are the same thing in disguise: use `w.button`, or `class="w-btn" data-tone data-size`. The visual `procs.ui.*` components are marked
`@deprecated`, keep working for compatibility, and each one names its replacement:

| `procs.ui.*` | `w.*` |
|---|---|
| escape, attr | `w.escape`, `w.marks` |
| button | `w.button` (`submit`, `marks`, `attrs`, `keys`, `wide`), `w.iconButton`, or `w.pressable` for chrome styled by its container |
| page, heading, row | `w.page`, `w.heading`, `w.record` |
| field, form, select, textarea | `w.input` + `w.field`, `w.form`, `w.select`, `w.textarea` |
| dialog, dialogButton | `w.dialog`, `w.dialogOpener` |
| listPage, detailPage, filterBar | `w.page` (`aside`, `crumbs`) + `w.toolbar` with `w.tabs` and a `w.form` search, rows as `w.record` in a flush `w.card` |
| breadcrumb, segmented, stats, sparkline | `w.crumbs`, `w.segmented`, `w.stats`, `w.sparkline` |
| respond | `w.respond` |
| notice | `w.toast` (carries `data-role="notice"`) |
| box, card | `w.card` (`flush` for records) |
| empty, alert | `w.empty` |
| descriptionList, tags, listItem, statusDot | `w.keyValue`, one `w.badge` per chip, `w.listRow`, `w.dot` |

`w.hooks` is the only way extra attributes reach a widget: behaviour hooks (`data-*`, `aria-*`, `hx-confirm`,
`onclick`, `id`, `form`, `popovertarget`) pass, `class` and `style` are refused.

**What stays in the framework.** `src/procs/` is the vendored procs framework (CLAUDE.md: patch it minimally,
fix upstream). It keeps its own `procs.ui` for the pages it draws before any app exists: `procs.http.dispatch`
and `procs.http.handle` answer a miss with `procs.ui.notFound` when the app registers no `ui.notFound`, `procs.http.toResponse` wraps a bare string in
`procs.ui.layout` only when the app registers no `ui.layout`. Hyper overrides both (`src/ui/layout.ts`,
`src/ui/notFound.ts`), so `procs.ui` draws nothing in Hyper. These framework helpers (`notFound`, `layout`, `page`, `respond`, `escape`, `attr`, `field`, `form`) are not
marked `@deprecated`, so the `deprecated` rule stays at 0; they should not be rewritten onto `w` in the vendored
copy.

### Palette

The default visual language is four base colours — white, grey, blue and black — plus one super accent used sparingly (principles 1–2 above). Green, amber and red appear only for semantic success, warning and danger on the element they describe.

Themes are selected with `data-theme="light"` or `data-theme="dark"` on `<html>`. The early script in `ui.layout` restores `localStorage.hyper-theme`, falling back to the OS preference before the page paints.

Theme values live in `src/procs/styles/$style_app.css`:

- `--theme-base-100`, `--theme-base-200`, `--theme-base-300` — raised, chrome, and divider surfaces;
- `--theme-base-content` — primary foreground;
- `--theme-primary`, `--theme-primary-content` — high-emphasis neutral action;
- `--theme-success`, `--theme-danger` — semantic states;
- `--ui-border`, `--ui-border-strong`, `--ui-input-border` — structural, emphasized, and form-control borders;
- `--ui-surface`, `--ui-surface-muted` — reusable surfaces.

Use semantic Tailwind classes such as `bg-base-100`, `bg-base-200`, `text-base-content`, `border-ui-border`, `border-ui-input`, `text-success`, and `text-error`. Do not add fixed `gray-*`, `white`, `blue-*`, or theme-specific colors to shared UI.

### Native component primitives

The project stylesheet defines compact component classes used by server renderers:

- buttons: `btn`, `btn-primary`, `btn-ghost`, `btn-xs`, `btn-sm`, `btn-circle`, `btn-square`;
- form controls: `input`, `textarea`, `select`, their `*-sm` variants, and `toggle`;
- status: `badge`, `badge-sm`, `progress`, `status`;
- containers: `card`, `card-border`, `card-body`, `alert`, `table`, `menu`;
- composition: `dropdown`, `join`, `avatar`, `breadcrumbs`, `steps`, `tooltip`.

Prefer runtime renderers for repeated structures:

- `ui.inspectorSection` — inspector accordion sections;
- `ui.statusBadge` — semantic status labels;
- `ui.progressBar` — compact progress;
- `ui.chatEventCard` — chat lifecycle cards;
- `procs.ui.*` — generic button, field, menu, table, badge, toggle, and related primitives.

### Chat conventions

User and assistant messages remain visually distinct, but all text inherits theme foreground tokens. Lifecycle events use `ui.chatEventCard`. Tool calls remain compact circular icon controls and open the shared popup; tool details must label Input and Output explicitly.

Every visible button must have visible text, `title`, or `aria-label`. Inputs must use `--ui-input-border`, which is intentionally stronger than structural separators. Shared controls must be checked in both themes.

## Verification

After changing tokens or component CSS:

1. hot-reload affected renderers;
2. call `procs.styles.rebuild({})`;
3. inspect representative pages in light and dark;
4. verify computed foreground, background, border, overflow, labels, and popup states;
5. close browser tabs created for the check;
6. run focused UI tests and `git diff --check`.
