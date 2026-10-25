# UI design system

Hyper-code2 owns its UI component and theme layer. Tailwind supplies utilities and the Typography plugin; there is no external component framework.

## Principles

1. **The base is four colours: white, grey, blue and black.**
   - **White** — the document: the page you read and write on.
   - **Grey** — a scale of shades for chrome, surfaces, lines and quiet text (chrome → chat → document).
   - **Blue** — a scale of shades for what is interactive or alive: links, selection, the current item, focus,
     "running", info.
   - **Black (ink)** — body text, the person's message bubble and the primary button: the strongest contrast on the
     page, it marks "mine" and "do this".

   Hierarchy comes from these four and from weight and size; nothing is coloured for decoration.
2. **A super accent — only when it matters.** One hue outside the base four, kept for the one
   thing that needs the person now (an agent waiting for an answer, an unread mention, the irreversible action in a
   dialog). If it is in two places on a screen, one of them should not be. Semantic states (success, warning,
   danger) are rare too and appear only on the element they describe.
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
5. **The server draws.** A widget is a function that returns HTML; behaviour is htmx attributes and native HTML
   (popover, details, dialog). Client JS only where nothing else works: dragging, keys, the clipboard.
6. **Meaning, not looks.** Props say what a thing is (`tone: "danger"`, `state: "running"`, `size: "sm"`), never how it
   looks; no classes passed in from outside.
7. **Tokens only.** Colours, sizes, radii and type come from variables; a theme changes only the variables.
8. **One action shape.** Everything clickable takes one `Action` with exactly one kind.
9. **Quiet and flat.** Panes are ruled by 1px lines; grey chrome, white documents. Radius and shadow only for what
   floats above the page (popovers, menus, the folded chat).
10. **Dense, on one grid.** Sizes 24 / 28 / 32 / 40 px, text 12–14 px, every header on the same 32 px line.
11. **Accessible by default.** Labels, focus, keyboard and a high-contrast theme are built in, not added later.
12. **One thing per file, and it is in the gallery.** Every widget is `w.<name>` and appears on `/rpc/w.gallery`; agents
    and plugins build their pages from the same set.

The widget set lives in `src/w` (atomic design: tokens → atoms → molecules → organisms → templates, one cascade layer
per level in `src/w/$style_w.css`). The older `procs.ui.*` components remain until pages move over.

## Palette

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
