# Function tags

A function tag is a JSDoc block tag on a runtime function that other code acts on:

```ts
/**
 * Shows the memory entry as a page.
 * @view
 * @live memory
 */
export default async function (ctx, session, opts: { key: string }) { … }
```

`@view` makes the function open by address (`GET /rpc/<fn>?<json>`, a canvas `view` tab), `@live memory` makes that
page re-fetch itself when the server refreshes the `memory` topic, and both make the function findable:
`runtime.docs.search({ tag: "view" })`. Plugins bring many such functions; agents find them by tag and query
instead of reading a list in the prompt.

## Declaring a tag

Which tags exist is declared by files, in the same grammar as `$setting_`, `$route_`, `$fence_`:

```
src/<mod>/$tag_<name>.ts   →  the tag @<name>     export default { summary, arg?, repeatable? } satisfies types.runtime.docs.Tag
```

| field | meaning |
|---|---|
| `summary` | one line: what a function with this tag is or can do (required) |
| `arg` | the tag takes one word after it, named here: `"kind"` for `@canvas <kind>`, `"topic"` for `@live <topic>` |
| `repeatable` | the tag may appear several times on one function; default `false` |

The framework declares three:

| tag | file | consumers |
|---|---|---|
| `@view` | `src/rpc/$tag_view.ts` | `rpc.render` (GET /rpc refuses functions without it), canvas `view` tab, `canvas.search` |
| `@canvas <kind>` | `src/canvas/$tag_canvas.ts` | `canvas.search`, the canvas prompt rule (`canvas: true`) |
| `@live <topic>` | `src/procs/events/$tag_live.ts` | `rpc.render` wraps the page in a live region for the topic |

A plugin declares its own tags the same way. One declaration per name: a second module declaring an existing tag
is refused at load (`tag @view is already declared by rpc/$tag_view.ts`), so a plugin cannot quietly change what
`@view` means. The same file reloaded (hot reload of the module) replaces its own declaration.

`@view` states an intent, it is not proof: nothing checks that a view changes nothing. Keep views read-only.

## How tags are read

`procs/$loader_fn.ts` (reflectSource) keeps every JSDoc block tag that is not standard JSDoc (`@param`,
`@returns`, `@default`, `@see`, `@throws`, `@deprecated`, … — the list is `STANDARD_TAGS` there) and that opens its
own line, as `meta.tags`:

```
@view          →  { view: [] }
@live memory   →  { live: ["memory"] }
```

Only the first word after the tag is its value; the rest of the line is prose. A tag written in the middle of a
sentence ("the @mentions badge") is not a tag. `meta.view`, `meta.live` and `meta.canvas` are derived from
`meta.tags` for the existing consumers.

## Index and search

`runtime.docs.index` writes `meta.tags` to `functions.tags` (jsonb, GIN index), compared in its canonical form so an
unchanged function is not rewritten. Search filters in every mode (bm25, hybrid, vector, lexical fallback):

```ts
await ctx.fns.runtime.docs.search({ tag: "view" })                                  // every view, by name; no query needed
await ctx.fns.runtime.docs.search({ query: "calendar day", tag: "view" })           // ranked inside the views
await ctx.fns.runtime.docs.search({ query: "tests", tag: "canvas", tagValue: "tests" })
await ctx.fns.runtime.docs.tags({})                                                 // declared tags, owner, how many functions carry each
```

An unknown tag is an error that names the known ones. Functions of a memory level the caller may not run
(`user_*`, `project_*`, `agent_*`, decided by `project.canCall`) are left out before the limit, in search and in
the counts of `runtime.docs.tags`; a call without a session (the server itself) sees everything. The index itself
is global.

## Checks

`code.quality` (check `tags`, on by default):

- `unknown-tag`: a tag no `$tag_` file declares, usually a typo (`@veiw`). Declare it or fix the spelling.
- `tag-arg`: a tag used against its declaration: missing `<arg>`, an argument on a bare tag, or a non-repeatable
  tag written twice (consumers would use only the first value).

## Adding a tag

1. Write `src/<mod>/$tag_<name>.ts` with a summary (and `arg` if it takes a value).
2. Hot-reload the module (`procs.repl.load({ name: "<mod>" })`); `runtime.docs.tags({})` lists it.
3. Tag functions in their JSDoc; reload them; `runtime.docs.search({ tag: "<name>" })` finds them.
4. Add a tag only when some code acts on it: a tag nobody reads is a comment.
