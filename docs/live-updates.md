# Live updates in the browser

How a Hyper page learns that something changed on the server, and how it makes sure it never shows stale
state after missing some of those notices. Read this before adding anything to a page that should
"update by itself".

Related: [ui-live-rendering.md](ui-live-rendering.md) (server-rendered live regions), [https.md](https.md)
(the HTTP/2 port).

## The one rule

**An event is a hint; the server's GET is the truth.**

Events tell a page *that* something changed. They are not stored and not replayed: a page that was not
listening when an event went out never gets it. So every piece of the page that mirrors server state must
be able to re-read that state on its own, and must do so after every gap in the stream.

## Pieces

```
server                                         browser tab
──────                                         ───────────
write (canvas.show, dock.pin, a message…)
  └─ procs.events.emit({ topic?, event })
        │
GET /procs/events?topics=…  ── SSE ──────────► procs/events/client.js   (window.hyperLive)
  first message: hello{serverStart}              │  transport: keep the stream or give it back
                                                 │  delivery:  event → matching subscribers
                                                 │  gap      → resync() on every state subscriber
                                                 │             + re-fetch every live region
                                                 ▼
GET <state route>  ◄────── resync ─────────── subscribers: canvas, dock, mentions, agent meta,
(/canvas/:id/state, /dock,                       flow count, secure input, live regions…
 /mentions/badge, …)
```

- `src/procs/events/emit.ts`, `subscribe.ts`: the in-process bus. A topic narrows who hears an event; no
  topic means everybody.
- `src/procs/events/$route__GET.ts`: the SSE stream. Every connection starts with
  `{ type: "hello", serverStart }`.
- `src/procs/events/client.js`: the browser half. Loaded first on every page (`ui/layout.ts`) and exposes
  `window.hyperLive`.

## Transport: when a tab keeps its stream

Over **HTTP/1.1** Chrome allows six connections per origin, and an SSE stream holds one for as long as it
lives. A handful of background tabs used to take all six and every ordinary request on the site froze
(fixed in b79a7ce, Aug 2026, by closing the stream of hidden tabs).

Over **HTTP/2 or HTTP/3** every request of an origin shares one multiplexed connection, so an open stream
costs nothing. Hyper serves HTTP/2 on its HTTPS port (`src/h2`, default 3443; the hyper-mesh domains are
HTTP/2 too).

`client.js` decides per tab, from the protocol that actually carried the page
(`performance.getEntriesByType('navigation')[0].nextHopProtocol`):

| page loaded over | visible tab | hidden tab |
|---|---|---|
| `h2` / `h3` | stream open | **stream stays open** — events keep arriving |
| `http/1.1` (plain `:3010`) | stream open | stream closed; reconnects on return, then resyncs |

Nothing to configure. `window.hyperLive.keepsStreamWhileHidden()` tells which case a tab is in.

## Gaps and resync

A gap is any period in which events may have been lost:

- the tab was hidden on HTTP/1.1 (stream given back);
- the network dropped and `EventSource` reconnected;
- Chrome froze a long-hidden tab (`resume` event);
- the server restarted (a different `serverStart` in `hello` → the page reloads; nothing to resync).

After a gap `client.js` calls `resyncAll(reason)`: every live region (`data-live-topic`) re-fetches itself
and every state subscriber's `resync(reason)` runs. A hidden tab postpones this until it is shown. The
first `hello` of a freshly rendered page and the reconnect after a planned topic change are not gaps: that
markup was just rendered by the server.

## Subscribing: `window.hyperLive`

Browser code never listens to the stream directly. It registers:

```js
// Something that mirrors server state: a badge, a panel, the canvas.
window.hyperLive.subscribe({
    name: 'dock',                    // for error messages
    types: ['dock.changed'],         // event types; omit for all
    onEvent: event => refresh(),     // quick reaction to one event
    resync: reason => refresh(),     // REQUIRED: re-read your state from the server
});

// A one-shot instruction with no state behind it: navigate, show a toast, run code.
window.hyperLive.command({
    name: 'ui-control',
    types: ['ui.navigate', 'ui.notify'],
    onEvent: applyEvent,
});
```

Both return an unsubscribe function. `subscribe` throws without `resync` — that is the point: a subscriber
cannot be written that forgets to catch up.

Choosing between them:

- **State** → `subscribe`. If there is no GET that returns the current state, add one; it is usually a few
  lines (see `src/canvas/$id/state/$route__GET.ts`). Often the existing render route is enough (`/dock`,
  `/mentions/badge`, `/ui/gap-count`).
- **Command** → `command`. A command sent while the tab was away is lost. Whoever sends it owns a timeout
  (`ui.eval`, `screen.eval`). If losing it would leave the page wrong, it is state, not a command: keep the
  state on the server and `subscribe` (the secure-input prompt does this — `secureInput.current` is the
  state, the event only says "look again").

Current subscribers:

| subscriber | file | events | resync reads |
|---|---|---|---|
| live regions | `procs/events/client.js` (built in) | any event with a `topic` | each region's own `hx-get` |
| canvas | `canvas/$script_canvas.js` | `canvas.changed` | `GET /canvas/:id/state`, then `/canvas/:id/panel` if the revision differs |
| dock | `dock/$script_dock.js` | `dock.changed` | `GET /dock` |
| mentions badge | `mentions/$script_live.js` | `mentions.changed` | `GET /mentions/badge` |
| agent meta panel | `ui/$script_meta.js` | `ui.metaSection` | every section via `ui.agentMetaSectionHtml` |
| attention-gap count | `ui/$script_gap-count.js` | `flow.count` | `GET /ui/gap-count` |
| secure input | `ui/$script_popup.js` | `secure-input.prompt(.closed)` | `secureInput.current` |
| commands | `ui/controlScript.ts` | `ui.navigate`, `ui.notify`, `ui.eval`, `ui.action`, `eval`, `agent.event_appended` | — (command) |

For server-rendered fragments prefer a live region (`ui.live`, see ui-live-rendering.md): it gets
re-fetching on events and on gaps for free.

## Guard rails

- **`code.quality` rule `live-subscribe` (error).** `addEventListener('hyper-events' | 'hyper-ui-event')`
  anywhere but `client.js` — in `$script_*.js`, a module's `client.js`, or a script embedded as a string in
  TypeScript. `code.index` runs the text rules over browser scripts for this. For compatibility
  `client.js` still dispatches the `hyper-events` DOM event, so an old private plugin keeps working, but it
  is flagged.
- **Browser tests** in headless Chrome against the real page and stream:
  - `src/procs/events/live.browser.it.test.ts` — HTTP/1.1 hidden tab resyncs every subscriber on return;
    HTTP/2 hidden tab keeps receiving; `subscribe` without `resync` is refused.
  - `src/canvas/canvas.browser.it.test.ts` — the canvas the agent opened while the tab was hidden appears
    on return.

  A new subscriber should be added to the HTTP/1.1 test's checks when it can be observed from the page.

## Checklist for a new live piece of UI

1. Server: after the write, `ctx.fns.procs.events.emit({ event: { type: "<thing>.changed", … } })`.
2. Server: a GET that returns the current state (or markup) — reads must never emit.
3. Browser: a live region (`ui.live`) if it is a server fragment; otherwise
   `window.hyperLive.subscribe({ types, onEvent, resync })`, with `resync` calling that GET.
4. Load the script after `client.js` (any script in the page body is; `layout.ts` puts `client.js` first in
   the head).
5. Test: hide the page, change the thing on the server, show the page, expect the new state.

## History

- **Aug 21, 2026 — b79a7ce.** Hidden tabs close their stream to stop HTTP/1.1 connection starvation.
  Live regions re-fetch on return; other listeners were not told.
- **Sep 26, 2026 — 38994c9.** HTTP/2 port; starvation can no longer happen there, but hidden tabs still
  closed their streams.
- **Oct 12, 2026 — b1f0578.** Canvas listens to `canvas.changed` only; a canvas opened while the tab was
  hidden never showed up.
- **Oct 16, 2026.** `fb74858` patched the canvas; then this design: streams stay open on HTTP/2, one
  `resync` after every gap, `hyperLive.subscribe` with mandatory `resync`, the `live-subscribe` rule and the
  browser tests.
