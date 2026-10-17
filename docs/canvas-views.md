# Canvas views: a tab is an address

**Status:** iteration 1 — `@view` functions, `GET /rpc/<fn>?<json>`, the `view` canvas kind with its own
history, `memory.view` and `memory.table`. The older kinds (file, html, url, plugin kinds) are unchanged.

## Why

A canvas tab used to be a row (`canvas_items.kind` + `payload`) with no address: it could not be shared, linked
from another page or opened in a browser tab, and only url and file tabs could move. Decided 2026-10-16
(memory note `notes/canvas-model.md`): the canvas looks at a resource, and a resource has a URL. A view is a
function `(ctx, session, opts) → html`, its address is the call.

## Pieces

| piece | file | what |
|---|---|---|
| `@view` tag | `src/procs/$loader_fn.ts` | JSDoc tag → `meta.view`. Means: only reads, returns a page. |
| address | `src/rpc/url.ts`, `src/rpc/canonicalJson.ts` | `/rpc/<fn>?<json>`, keys sorted at every depth; empty params → bare `/rpc/<fn>` |
| route | `src/rpc/$route_$fn_GET.ts` | sign-in like every page; only `@view` (405 otherwise); `project.canCall` for level functions; query is JSON, or `?a=1&b=2` for hand-typed links; the view runs with the person on `session.user` |
| page | `src/rpc/page.ts` | string → html as is; array of objects → table; other → JSON. CSP `sandbox` header: opaque origin, no network, no forms |
| tab | `src/canvas/$canvas_view.ts` | args `{ fn, params }` or `{ url }`, canonicalized; address bar, ◀ ▶, reload, open in a new browser tab |
| history | `src/canvas/navigate.ts` | view tabs keep `state.back` / `state.forward` (50 each); `history: "back" \| "forward"` |
| links | `rpc.page` bridge + `$script_canvas.js` | a `/rpc/…` link clicked in a framed view posts `navigate`; the canvas moves the same tab. Other links open a new browser tab. Opened directly (not in a frame), links work as ordinary links |
| reader | `src/memory/visible.ts` | the memory filter for an agent (its four levels) or a person (system, own user level, all projects, the agents they created; the owner also sees agents without a creator) |
| first views | `src/memory/view.ts`, `src/memory/table.ts` | a note as markdown (`[[name]]` and relative `.md` links become view links), a record as JSON, a function's source; a table of entries with prefix links |

## Html pages are memory pages

`canvas.show({ kind: "html", args: { html } })` with a static page (no `load`, no `hyper.*` page API) writes it to
memory as `pages/<slug of the title>.html` — the project level, or the agent's when it has no project — and opens
a `view` tab at `/rpc/memory.view?{"key":"pages/…"}`. `memory.view` serves a saved html document as it is (its own
styles), `rpc.page` only puts the link bridge in front. Showing a page with the same title again rewrites the file
and bumps `state.page` on the same tab, so the frame reloads. Interactive pages (`hyper.setState`, `ping`, server
`load`) stay `html` tabs: they need the html frame bridge.

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
address names a function and its arguments, not source; escape everything that comes from data. Who may call it
is decided like `POST /rpc`. A view called by a person sees the person (`session.user`); called by an agent, the
agent.

## Not in iteration 1

- Moving file tabs, interactive html tabs and plugin kinds onto addresses.
- Live refresh of view tabs (today: the reload button, and a fresh render when the tab is shown again).
- Share links outside the instance.
