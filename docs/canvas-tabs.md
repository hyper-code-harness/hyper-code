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

## Tidying a long strip

`shown_at` records when a tab was last the shown one (canvas.show, canvas.update activeItemId, canvas.reopen).
After `canvas.show` opens a tab, `canvas.tidy` puts away the unpinned tabs shown least recently once there are
more than the `canvas.maxTabs` setting (default 12, `0` turns it off). Put away = closed: the tab is listed under
Recently closed with its args and state for 30 days and `canvas.reopen` brings it back. The active tab and the
tab just opened stay.
