# UI rendering and live updates

## Goal

Keep the UI server-rendered and HTMX-driven while removing one-off refresh loops and global browser state.

The implementation follows three rules:

1. **Every live server fragment uses one contract.** A region declares its URL and topic. The shared SSE client turns a topic notification into one coalesced HTMX refresh. Timers are watchdogs only.
2. **Transcript rows are summaries.** Expensive tool arguments, diffs, and highlighted output are fetched only when opened.
3. **One chat panel owns one disposable controller.** Panel listeners and in-flight requests are aborted when HTMX removes the panel. Configuration lives on the panel DOM, not in `window` globals.

## Live-region contract

`ui.live` renders a region with:

- `hx-get`: canonical server fragment URL;
- `data-live-topic`: SSE topic to watch;
- `hx-trigger`: `hyper-live from:body` plus a watchdog interval;
- configurable element tag and HTMX swap mode.

The browser keeps one topic-filtered SSE connection per tab. Over HTTP/2 it stays open while the tab is hidden; over HTTP/1.1 a hidden tab closes it (Chrome's six-connections-per-origin pool) and resyncs on return. Transport, gaps and the `window.hyperLive` subscriber contract for non-region UI are in [live-updates.md](live-updates.md). Signals carry invalidation, not HTML. Signals within 100 ms are coalesced. Matching visible regions receive `hyper-live`; HTMX asks the server for current markup.

Current topics:

- `agent:<id>` — transcript tail, status, reflection state;
- `agents` — navigation rail.

Reads never publish invalidations, so refreshing a region cannot create a refresh loop.

## Chat transcript

Initial chat HTML contains the latest 100 events. `#msg-head` pages older events upward and preserves the viewport. `#msg-tail` is a live region on `agent:<id>` and requests only events after its offset. The offset is transcript state in the URL, not state in the SSE protocol.

Tool-call events render as compact buttons keyed by `(agent_id, event_idx)`. Opening one calls popup RPC `agent.toolDetails`, which performs syntax highlighting and edit diff rendering on demand. The chat controller caches successful detail fragments for its lifetime.

## Chat controller lifecycle

`agent/chat.js` maintains at most one controller for the current `#chat-panel`.

- `htmx:beforeCleanupElement` destroys a controller whose panel is being removed.
- `htmx:afterSwap` mounts the current panel.
- `AbortController` removes panel listeners and cancels detail fetches.
- panel configuration is read from `data-*` attributes.
- stale async work checks controller identity before changing the dialog.

The controller owns scroll anchoring, upward paging, Enter-to-submit, inherited-context notice, tool trays, detail cache, and tool dialog focus restoration. Global `ui/hotkeys.js` owns `Cmd+J/K` scrolling plus `Ctrl+J` next-unread and `Ctrl+K` per-tab back history; navigation shortcuts intentionally work with composer focus.

## Watchdogs

Live updates should normally arrive over SSE. Watchdogs repair missed signals:

- busy status: 5 s, because elapsed time is visible;
- ordinary agent fragments: 30 s;
- agents rail: 60 s.

Do not introduce one-second polling for new widgets. Publish the relevant topic after a write instead.

## Verification

Minimum checks for changes to this path:

- `ui.live` contract tests;
- event paging route tests;
- lazy tool-detail route and summary-renderer tests;
- chat controller syntax/browser smoke test;
- manual browser check: switch agents repeatedly, test `Cmd+J/K` and `Ctrl+J/K` with composer focus, send with Enter, receive a live reply, page upward without jumping, hide/show multiple tabs without connection starvation, and open the same tool twice without a second request.
