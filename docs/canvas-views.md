# Canvas views: a tab is an address

**Status:** `@view` functions as htmx fragments at `GET /rpc/<fn>?<json>`, the `view` canvas kind with its own
history, drawn on the server in one request; memory, saved pages, files and plugin kinds are views; `@live` views refresh on server events.

## Three kinds of tab, and how to pick one (issue #8)

An audit of 130 tabs by 12 agents (2026-10-20) found agents guessing between file, html, view and live tabs.
The main mistake: an html page with a Mermaid `<script>` from a CDN (8 of 9 scripted pages) — it becomes a framed
snapshot with no address and no memory. Next: documents written to `.hyper/tmp`, the same file in several tabs.

There are three kinds of tab; the agent takes the first that fits:

1. **Ours → a Hyper address `/rpc/<fn>?<json>`** (an htmx fragment in the page). `file` (`{ path }` →
   `files.page`), a static html document (`{ html }` → memory `pages/<slug>.html` → `memory.view`) and plugin
   kinds are shortcuts to it. Pages are found with `canvas.search({ query })`, which ranks `@view` functions by the
   function index (`runtime.docs.search({ tag: "view" })`), so a plugin's pages are found as soon as it loads and
   the prompt never lists them. Html that must run code (an animation, `hyper.*`) stays a sandboxed frame — rare.
2. **A web site → `url`**, framed; sites that forbid framing show through the canvas frames extension.
3. **A live session → `browser.live`**, the Hyper machine's Chrome — only for a login, a captcha or automation.

`canvas.show` helps instead of only documenting: `kind` is optional (args decide — `path`, `fn` / `/rpc/…`
url, `html`, `https://` url); the answer carries `address`, `reused`, `fixed` and `hint`. A page whose only
scripts draw Mermaid is drawn on the server (`mermaid.render`) and saved as a static page (`fixed` says so); Mermaid
next to other scripts is left alone with a `hint`; a file from `.hyper/tmp` gets a `hint`. The prompt block
(`canvas.promptSection`) is the same ladder with bad → good examples.

## Why

A canvas tab used to be a row (`canvas_items.kind` + `payload`) with no address: it could not be shared, linked
from another page or opened in a browser tab, and only url and file tabs could move. Decided 2026-10-16
(memory note `notes/canvas-model.md`): the canvas looks at a resource, and a resource has a URL. A view is a
function `(ctx, session, opts) → html`, its address is the call.

## How a view is shown: htmx fragments, not frames

A view returns an html **fragment**. `rpc.render` makes the call (address → function → `rpc.page` fragment, with
the status); it is shared by the route and the canvas:

- `GET /rpc/<fn>?<json>` with `HX-Request` answers the fragment alone; a plain browser visit gets the same fragment
  inside the Hyper page layout (`procs.http.toResponse`).
- A canvas `view` tab draws the fragment into the panel **on the server**. A tab action from canvas.js (select,
  link, ◀ ▶, address bar) is one `POST /canvas/:id` with `x-canvas-panel: 1`; the answer carries the new panel,
  so opening a tab is one round trip (it was three: POST, GET /panel, the view's own fetch). While a tab action is
  in flight the body is marked `aria-busy`: canvas.css hides the old content and shows a spinner and a top bar.
- A fragment that needs isolated scripts carries its own `<iframe>`.
- Where a link click opens (this tab with a history step, a new canvas tab, a new browser tab): [canvas-links.md](canvas-links.md).

## Plugin kinds are views

A canvas kind may name a view: `view: "code.testsPage"` in its `$canvas_*.ts`. `canvas.show` then opens a `view`
tab of that function with the args `prepare` returns as params, so the tab has an address and history. Views of
running apps (d3 maps, the test report with its Run button, the calendar, the icon browser) return
`rpc.frame({ src | srcdoc })` — the app stays in its own frame inside the fragment. A framed page may post
`{ hyperCanvas: 1, type: "navigate", params }` to move its tab to the same view with other params (the calendar
does this for ‹ ›, so ◀ ▶ step through days).

| kind | view |
|---|---|
| `architectureMap.map` | `architectureMap.mapPage` |
| `architectureMap.turbulence` | `architectureMap.turbulencePage` |
| `code.tests` | `code.testsPage` |
| `gcal.calendar` | `gcal.dayPage` |
| `icons.browser` | `icons.page` |

## Live views

`@live <topic>` next to `@view` makes the page follow a live-update topic: `rpc.render` wraps it in a live region
(`hx-get` of its own address, `data-live-topic`), and when the server calls
`procs.events.refresh({ topic })` every open copy — canvas tab or browser page — re-fetches itself
(see live-updates.md). `memory.view` and `memory.table` are `@live memory`; memory.write/put/edit/remove/setStatus
refresh `memory`. The canvas panel announces new regions with the `hyper:regions` event so the stream subscribes
to their topics.

`@view`, `@canvas` and `@live` are function tags declared by `$tag_` files; every view can be found with
`runtime.docs.search({ tag: "view", query })` — see [function-tags.md](function-tags.md).

Tab order, pinning, drag and drop and the tidying of a long strip: [canvas-tabs.md](canvas-tabs.md).

## Pieces

| piece | file | what |
|---|---|---|
| `@view` tag | `src/procs/$loader_fn.ts` | JSDoc tag → `meta.view`. Means: only reads, returns a fragment. |
| address | `src/rpc/url.ts`, `src/rpc/canonicalJson.ts` | `/rpc/<fn>?<json>`, keys sorted at every depth; empty params → bare `/rpc/<fn>` |
| call | `src/rpc/render.ts` | parses the address; only `@view` (405), `project.canCall` (403); reads as the person, else the agent, else the owner (open instance); errors come back as an error fragment |
| route | `src/rpc/$route_$fn_GET.ts` | sign-in like every page, then `rpc.render` |
| fragment | `src/rpc/page.ts`, `src/rpc/$style_rpc.css` | string → as is; array of objects → table; other → JSON; wrapped in `.rpc-view` |
| cleaning | `src/rpc/cleanHtml.ts` | for html agents wrote (notes, saved pages): drops scripts, iframes, forms, on*/hx-* attributes, javascript: links; scopes a page's `<style>` to its block |
| tab | `src/canvas/$canvas_view.ts` | args `{ fn, params }` or `{ url }`; address bar, ◀ ▶, reload, open in a new browser tab |
| history | `src/canvas/navigate.ts` | `state.back` / `state.forward` (50 each); `history: "back" \| "forward"` |
| files | `src/files/page.ts` | `files.page` — the Files viewer as a view. `canvas.show({ kind: "file" })` pins the path and opens a view of it; file links inside move the same tab |
| reader | `src/memory/visible.ts` | the memory filter for an agent (its four levels) or a person |
| memory views | `src/memory/view.ts`, `src/memory/table.ts` | a note as markdown (`[[name]]` links), a saved page with its own scoped styles, a record as JSON, a function's source; a table of entries |

Access: a view opens for any signed-in person (as the /files page does), never without sign-in; level functions
(`user_`, `project_`, `agent_`) are checked by `project.canCall`.

## Html pages are memory pages

`canvas.show({ kind: "html", args: { html } })` with a page without scripts (no `<script>`, no `on…=`, no `load`) writes it to
memory as `pages/<slug of the title>.html` — the project level, or the agent's when it has no project — and opens
a `view` tab at `/rpc/memory.view?{"key":"pages/…"}`. `memory.view` shows a saved page cleaned (rpc.cleanHtml), its
`<style>` scoped to the page block. Showing a page with the same title again rewrites the file
and bumps `state.page` on the same tab, so the frame reloads. Pages with scripts (`hyper.setState`, `ping`, an animation,
server `load`) stay `html` tabs in their sandboxed frame.

## Writing a view

```ts
/**
 * Shows … as a page.
 * @view
 * @param opts.x …
 */
export default async function (ctx: Context, session: Session | null, opts: { x?: string }): Promise<string> {
    const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
    return `<h1>${esc(opts.x ?? "")}</h1><a href="${ctx.fns.rpc.url({ fn: "memory.table", params: { prefix: "todo/" } })}">todos</a>`;
}
```

Rules: a view must not change anything (GET has no CSRF token); code is never taken from the URL — the
address names a function and its arguments, not source; escape everything that comes from data, and pass html
that agents or people wrote through `rpc.cleanHtml`. Who may call it
is decided like `POST /rpc`. A view called by a person sees the person (`session.user`); called by an agent, the
agent.

## Not in iteration 1

- The icon browser inlines its whole catalogue (~2 MB per panel): serve the data at its own address.
- Live refresh of view tabs (today: the reload button, and a fresh render when the tab is shown again).
- Share links outside the instance.
