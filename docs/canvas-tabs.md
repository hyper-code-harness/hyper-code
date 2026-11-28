# Canvas tabs: order, pinning, tidying

The tabs of a chat's canvas are rows of `canvas_items` (one chat = one `agent_id`), ordered by `position`.
`canvas.list` returns them pinned first, then the rest.

## Tab menu and pinning

A right-click on a tab opens its menu, as in Chrome: Pin / Unpin, Close, Close other tabs, Close tabs to the right
(the last two leave pinned tabs open). Each item posts `{ tabOp, itemId }` to `POST /canvas/:id`.

`canvas.pin({ itemId, pinned })` keeps a tab at the left of the strip:

- drawn short — two letters of its title (initials of the first two words), the full title as tooltip and
  accessible name — and without a close button;
- new tabs open right of the pinned ones, never in front of them;
- never put away by tidying (below).

Unpinned tabs show their title only; the kind's generic icon is dropped (a tab with its own `args.icon` keeps it).

Pinning is per chat. A tab pinned in every chat of a project (tests, a dashboard) is a later step: it needs
its own table, since a canvas tab belongs to one chat.

## Drag and drop

Every tab of a strip with more than one tab is `draggable` (w.tabs `draggable`). canvas.js shows a line where the
tab will land and posts `{ move: { itemId, before } }` to `POST /canvas/:id`; `canvas.move` puts it in front of
`before` (or at the end) and derives the pinned state from the place: dropped among the pinned tabs it is pinned,
dragged out of them it is unpinned. The pinned group always stays together at the left.

## Many tabs

Nothing closes a tab for the person. As in Chrome, a crowded strip shrinks its tabs evenly down to a few letters
(`canvas.css`: a container query drops the close button and the padding of a narrow tab), a pinned tab keeps its
width and the open tab keeps room for its name and close button. What still does not fit scrolls, and `canvas.js`
(`showActiveTab`) brings the open tab into view after every panel update.

The **All tabs** button (caret, right of the strip; `panelHtml`) is the way to any tab: a popover with every open
tab in the strip's order — pinned first, the open one marked, a close button on unpinned rows — and the recently
closed ones (50 newest), with a filter field once there are more than eight rows. `data-canvas-goto` switches,
`data-canvas-reopen` brings a closed tab back; Enter in the filter opens the first match.

## Tidying a long strip (off by default)

`shown_at` records when a tab was last the shown one (canvas.show, canvas.update activeItemId, canvas.reopen).
With the `canvas.maxTabs` setting above 0 (default `0` = off), `canvas.tidy` runs after `canvas.show` opens a tab
and puts away the unpinned tabs shown least recently beyond that many. Put away = closed: the tab is listed under
Recently closed with its args and state for 30 days and `canvas.reopen` brings it back. The active tab and the
tab just opened stay. `canvas.show` says how many were put away in `hint` — it is never silent.

## One thing, one tab

`canvas.show` looks for a tab that already shows the thing before it adds one:

- the same kind and args → that tab (open or recently closed) — `reused: true`;
- a file already open in another Files mode (`tab`: preview, code, edit) → that tab, moved to the asked mode;
- a content kind (`content: true` in its `$canvas_*.ts` — `html` with scripts, `svg.drawing`) shown under the title
  of an open tab of that kind → that tab, its content replaced. A static html page already works this way through
  memory (`pages/<slug of the title>.html`).

The last two say so in `fixed`. The prompt (`canvas.promptSection`) tells agents the rule: read the Canvas block,
reuse or navigate the tab, a new version goes out under the same title. Two tabs can still end on one address when
a person navigates one of them there — as in a browser.

## Drawing a tab again

`canvas.refresh({ itemId? })` (default: the open tab) bumps `canvas_items.version`; the version is part of the
body fingerprint (`canvas.revision`), so every page of the chat draws the tab again, hidden ones when they catch
up. Use it after changing the data behind a tab that is not a `@live` view. The ↻ button does the same for one page.
