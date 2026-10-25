# UI design system

Hyper-code2 owns its UI component and theme layer. Tailwind supplies utilities and the Typography plugin; there is no external component framework.

## Principles

1. **Three colours: white, grey and blue.** White is the document — the page you read and write on. The rest is two
   hues, each a scale of several shades: a cool **grey** scale for surfaces, lines and text (chrome → chat → document, quiet → body text) and a **blue** scale for
   what is interactive or alive — links, selection, the current item, focus, "running", info. Hierarchy comes from
   the shades of these two and from weight and size; nothing is coloured for decoration. **Black (ink)** is the
   darkest end of the grey scale, not a colour of its own: body text, the person's message bubble and the primary
   button are ink on white — the strongest contrast the page has, so it marks "mine" and "do this".
2. **A fourth colour — the super accent — only when it matters.** One hue outside white, grey and blue, kept for the one
   thing that needs the person now (an agent waiting for an answer, an unread mention, the irreversible action in a
   dialog). If it is in two places on a screen, one of them should not be. Semantic states (success, warning,
   danger) are rare too and appear only on the element they describe.
3. **The server draws.** A widget is a function that returns HTML; behaviour is htmx attributes and native HTML
   (popover, details, dialog). Client JS only where nothing else works: dragging, keys, the clipboard.
4. **Meaning, not looks.** Props say what a thing is (`tone: "danger"`, `state: "running"`, `size: "sm"`), never how it
   looks; no classes passed in from outside.
5. **Tokens only.** Colours, sizes, radii and type come from variables; a theme changes only the variables.
6. **One action shape.** Everything clickable takes one `Action` with exactly one kind.
7. **Quiet and flat.** Panes are ruled by 1px lines; grey chrome, white documents. Radius and shadow only for what
   floats above the page (popovers, menus, the folded chat).
8. **Dense, on one grid.** Sizes 24 / 28 / 32 / 40 px, text 12–14 px, every header on the same 32 px line.
9. **Accessible by default.** Labels, focus, keyboard and a high-contrast theme are built in, not added later.
10. **One thing per file, and it is in the gallery.** Every widget is `w.<name>` and appears on `/rpc/w.gallery`; agents
    and plugins build their pages from the same set.

The widget set lives in `src/w` (atomic design: tokens → atoms → molecules → organisms → templates, one cascade layer
per level in `src/w/$style_w.css`). The older `procs.ui.*` components remain until pages move over.

## Palette

The default visual language is white plus two hues — a grey scale and a blue scale — plus one super accent used sparingly (principles 1–2 above). Green, amber and red appear only for semantic success, warning and danger on the element they describe.

Themes are selected with `data-theme="light"` or `data-theme="dark"` on `<html>`. The early script in `ui.layout` restores `localStorage.hyper-theme`, falling back to the OS preference before the page paints.

Theme values live in `src/procs/styles/$style_app.css`:

- `--theme-base-100`, `--theme-base-200`, `--theme-base-300` — raised, chrome, and divider surfaces;
- `--theme-base-content` — primary foreground;
- `--theme-primary`, `--theme-primary-content` — high-emphasis neutral action;
- `--theme-success`, `--theme-danger` — semantic states;
- `--ui-border`, `--ui-border-strong`, `--ui-input-border` — structural, emphasized, and form-control borders;
- `--ui-surface`, `--ui-surface-muted` — reusable surfaces.

Use semantic Tailwind classes such as `bg-base-100`, `bg-base-200`, `text-base-content`, `border-ui-border`, `border-ui-input`, `text-success`, and `text-error`. Do not add fixed `gray-*`, `white`, `blue-*`, or theme-specific colors to shared UI.

## Native component primitives

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

## Chat conventions

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
