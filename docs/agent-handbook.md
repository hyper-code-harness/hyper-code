# Agent handbook

Detail that used to live in the system prompt. The prompt now carries only the
invariants; everything here is read on demand with the `read` tool when a task
actually needs it. Each section is self-contained — read the one section, not
the file.

## Runtime shape

```
ctx.env                                   env-var snapshot
await ctx.fns.procs.db.conn()             raw db access (usually go through ctx.fns.procs.db)
ctx.state.agent[id]                       live agents (parent + forks), keyed by id
ctx.state.settings.registry               declared settings registry
ctx.state.procs.http.routes               live HTTP route table
ctx.fns.<ns>.<fn>({ ...opts })            every procedure (ctx + session injected)
```

The live agent object:

```
agent.id                                  short two-letter id
agent.model                               "<provider>:<modelId>"
agent.systemPrompt                        per-agent addition on top of the base prompt
agent.messages                            OpenAI-shaped transcript (never push directly)
agent.events                              UI trace events (never push directly)
agent.scratchpad                          plain object, persistent across turns, NOT sent to the model
agent.parentId                            set on forks; effective transcript via getFullMessages
agent.abortController                     in-flight LLM abort signal
```

Bun globals worth knowing: `Bun.file`, `Bun.write`, `Bun.$`, `Bun.Glob`,
`Bun.spawn`, `Bun.hash`, `Bun.password`, `Bun.escapeHTML`, `Bun.Transpiler`,
`Bun.sleep`, `Bun.randomUUIDv7`; modules `bun:sqlite`, `Bun.sql`, `Bun.redis`,
`Bun.s3`. Inside `eval`, static `import` is forbidden — use `await import("…")`.

## Finding functions

There are ~100 namespaces. Do not try to recall them; look them up:

```ts
await ctx.fns.runtime.docs.search({ query: "english keywords" })   // rank by capability
await ctx.fns.runtime.docs.get({ name: "namespace.function" })     // docs, params, return type
Object.keys(ctx.fns.<ns>)                                          // raw listing of one namespace
```

Function tags are JSDoc tags: `@view` (opens as a page at `/rpc/<fn>?<json>`),
`@canvas <kind>`, `@live <topic>`. Filter with
`runtime.docs.search({ tag: "view" })`, add `query` to rank inside, `tagValue`
for the argument; `runtime.docs.tags({})` lists declared tags. A new tag needs a
`$tag_<name>.ts` file — see `docs/function-tags.md`.

## Call graph

Indexed in Postgres, refreshed on every save:

```ts
ctx.fns.code.callers({ name: "session.appendMessage" })  // who calls it — file + line
ctx.fns.code.callers({ name, depth: 3 })                 // transitively, up to entry points
ctx.fns.code.slice({ name })                             // source + callee signatures + call sites
ctx.fns.code.dead({ root: "core" })                      // uncalled vs called-only-by-its-test
ctx.fns.code.quality({})                                 // every warning at once; ok:false = broken
ctx.fns.code.quality({ rule: "empty-catch" })            // one rule: empty-catch, lost-cause,
                                                         // formdata-to-string, floating-promise,
                                                         // untested, extra-parameter, boundary,
                                                         // dead, test-only
ctx.fns.code.coverage({})                                // direct / indirect / none, by caller count
ctx.fns.code.boundary({})                                // committed code reaching into ~/.hyper
ctx.fns.code.index({})                                   // full reindex; ({ rel }) for one file
```

Use `code.slice` instead of opening five files by hand, and `code.callers`
before changing any signature. The index sees `ctx.fns` calls parsed from the
TypeScript AST, `types.<mod>.<Name>` uses, UI string dispatch and test calls —
not local helpers, and not raw SQL against another module's schema.

## File grammar

One thing per file:

```
src/<mod>/<fn>.ts                   → ctx.fns.<mod>.<fn>   export default async function (ctx, session, opts)
src/<mod>/<Name>.ts (capitalized)   → types.<mod>.<Name>   export type — auto-global via genTypes
src/<mod>/$setting_<key>.ts         → declared setting     export default { type, default, env, ... }
src/<mod>/$route_<path>_<METHOD>.ts → HTTP handler         _ = /, $param = :param
src/<mod>/$migration_<ts>_<name>.ts → Postgres migration   export default { up(ctx), down?(ctx) }
src/<mod>/$script_<name>.js         → browser asset        served as /<mod>/<name>.js
src/<mod>/$fence_<lang>.ts          → ```<lang> block      export default render + export const hint
src/<mod>/$tag_<name>.ts            → function tag @<name> export default { summary, arg? }
```

`.hyper/<mod>/<fn>.ts` in the code repo is the instance's platform overlay with
the same grammar, scanned after `src/` and overriding by name:
`.hyper/skill/uptime.ts` → `ctx.fns.skill.uptime`. It is platform code, changed
with the human's consent — not memory.

No cross-imports between project files — call via `ctx.fns`. `import` is only
for bun, `node:*` and npm.

After editing, hot-reload instead of restarting:

```ts
await ctx.fns.procs.repl.load({ name: "<mod>" })       // reload a namespace
await ctx.fns.procs.repl.load({ name: "<mod>.<fn>" })  // reload one function
await ctx.fns.procs.dev.genTypes({})                   // after add/remove file
await ctx.fns.procs.http.loadRoutes({})                // after touching $route_*.ts
await ctx.fns.procs.migrate.up({})                     // after dropping a $migration_*.ts
```

## Authoring a runtime function

Create with `ctx.fns.procs.dev.createFunction({ ... })`: it requires a
capability-focused summary and description, explicit `params` (use `[]` for
none), `returnType` and `body`, and it typechecks, reloads and validates
metadata. After changing an existing function with `edit`, hot-reload it and run
`ctx.fns.runtime.docs.validate({ name: "<mod>.<fn>", strict: true, typecheck: true })`.

Write JSDoc that states the exact supported capability and when to use it.
Document every `opts` field with a meaningful description and applicable
`@default` / `@minimum` / `@maximum`. Prefer precise types over `any`/`unknown`.
Do not hand-write keyword lists — index-time localization derives multilingual
retrieval text from honest TypeScript and JSDoc metadata.

## Storage and the queue

Postgres (paradedb, `:54393`). Always go through
`ctx.fns.procs.db.select/run/insert/exec` — bare `Bun.sql` defaults to
localhost:5432 and is not our database.

There is no `agent_jobs` table: the queue lives inline in
`agents(next_run_at, run_state, last_processed_msg_idx)`, claimed by
`workerLoop` with an atomic `UPDATE … RETURNING`. A tool result is a
`role='tool'` message carrying `tool_call_id` and `excluded_from_cursor=true`.
Inspect the live schema through `information_schema.columns` rather than
trusting a migration file.

## Plans

```ts
await ctx.fns.session.plan({ agent, title, tasks: [{ id, title, instructions }] })
await ctx.fns.session.done({ agent, id })
```

Keep task IDs stable. Call `done` only after the active task is actually
complete; it records time, activates the next task and returns it. Plans are
visible and editable by the user in the Meta panel. `session.updatePlan({ agent,
title, tasks })` edits while preserving state by ID;
`session.removePlan({ agent, archive })` archives or deletes.

## Delegation

```ts
const member = await ctx.fns.agent.delegate({
  agent,
  title: "Focused side task",
  tasks: [{ id: "inspect", title: "Inspect evidence", instructions: "..." }],
})
```

Prefer delegation for research, broad repository inspection, long tests,
deployment — self-contained work with noisy tool output. Keep tightly coupled
reasoning and small edits in the parent.

A child MUST call `agent.finishTask({ agent, summary, result })` with a concrete
JSON-compatible result after closing every plan task; completion without
`result` is invalid. The parent receives the summary automatically, can inspect
`agent.team({ agent })` and ask follow-ups with `agent.ask({ agent, member,
question })`. Archive with `agent.archiveMember({ agent, member })` or
`agent.archiveCompleted({ olderThanMs })`; inspect with
`agent.team({ agent, includeArchived: true })`; restore with
`agent.unarchiveMember({ agent, member })`. Archiving hides a child but
preserves its transcript, plan and result. Full detail: `docs/team-delegation.md`.

## Background work and triggers

Background work and durable triggers are rows of one jobs table; each reports
back as a message — end the turn, never sleep or poll.

```ts
bash({ command, background: true })                  // or background: { afterMs, wake }
eval({ code, background: true })
ctx.fns.agent.wake({ id: agent.id, at | inMs, prompt })          // once
ctx.fns.agent.cron({ id: agent.id, expression, timezone, prompt })// repeatedly
ctx.fns.agent.watch({ id: agent.id, predicate, opts, prompt, everyMs?, timeoutMs?, mode? })
ctx.fns.jobs.list({ status: "running" | "finished" | "all" })
ctx.fns.jobs.logs({ id })
ctx.fns.jobs.cancel({ id })                          // silent, no completion message
```

`watch` predicates: `file.exists { path }`, `db.rows { sql, params? }` (one
SELECT, `?` placeholders), `http.ok { url }`, `runtime.fn { name, args?,
callTimeoutMs? }`. Do not pass arbitrary code to a durable watch. Full detail:
`docs/jobs.md`.

Services (databases, dev servers): write `~/.hyper/units/<name>.yaml`, call
`ctx.fns.hyperd.reload({})`, control with `ctx.fns.hyperd.status/start/stop/restart/logs({ name })`.
Read `docs/hyperd.md` first.

## Memory

Four levels (system, user, project, agent), three kinds (files, records,
functions), all under `~/.hyper`, never in a repo. The "Your memory" block in
the turn context names the uid, project slug, folders and callable functions.

- Level by audience: a habit of the person → `user`; a decision or convention of
  the project → `project`; own working state → `agent` (default); `system` only
  when the instance owner asks.
- Kind by shape: prose someone reads and edits → `memory.write({ path:
  "notes/<topic>.md", content, title, description, kind, visibility })`; many
  similar filterable items → `memory.put({ key, data, title, kind, visibility })`;
  code that will run again → a function, never a snippet in a note.
- Look before writing: `memory.list({})` or `memory.list({ prefix: "notes/" })`;
  extend an existing note with `memory.edit({ key, oldText, newText })` instead
  of starting a second one.
- `visibility` is the level; a key found on several levels resolves nearest
  first: agent, project, user, system. `memory.file({ ref })` /
  `memory.read({ key })` open, `memory.remove` deletes.
- Functions live at `~/.hyper/src/<level>_<owner>/<fn>.ts`, same grammar as
  `src/`, loaded on save. To mark one ready it needs a `<fn>.test.ts` next to it
  and a JSDoc summary, then `memory.setStatus({ key: "fn/<full name>", status:
  "ready" })`.
- Never secrets. Keep `notes/where-we-stopped.md` current before long pauses and
  read it first after a compaction. Full detail: `docs/projects-and-memory.md`.

## Secrets

Before asking a human for credentials, call `await ctx.fns.secrets.list({ query })`
to discover existing `secret://` references and safe metadata — it never returns
values. Use a reference through a tool's `secrets` map, for example
`bash({ secrets: { TOKEN: "secret://namespace/name" } })`. Never print, log or
fetch a plain value into the transcript.

## Further reading

```
docs/architecture.md          DB schema, queue/worker, fork semantics, channels, recovery
docs/settings.md              declaring keys ($setting_), instance files, resolution order
docs/canvas-views.md          @view functions, @live topics, canvas kinds
docs/function-tags.md         declaring a new function tag
docs/jobs.md                  background jobs, wake, cron, watch
docs/team-delegation.md       delegation, team panel, finishTask contract
docs/projects-and-memory.md   memory levels, records, level functions
docs/hyperd.md                services and units
CLAUDE.md                     project conventions, REPL workflow, what NOT to do
```

Source files remain the final word.
