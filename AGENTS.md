---
description: hyper-code2 — procs-based Bun codebase with a self-extending agent at `/`.
alwaysApply: true
---

# hyper-code2 — agent guide

Procedural TypeScript on Bun, running on the **procs framework** (vendored at `src/procs/` — see `~/health-workspaces/procs` for the upstream). One HTTP server, a multi-agent chat driven by native JSON tool calls, all code hot-reloadable through a tokened external REPL.

## Runtime environment

- **Bun, not Node.js.** Use `bun`, `bun test`, `bun install`, `bunx`, `bun build`. `.env` loads automatically.
- Prefer Bun built-ins over npm packages: `Bun.serve()`, `Bun.file()`, `Bun.write()`, `Bun.$` shell, `Bun.Glob`, `Bun.spawn`, `bun:sqlite`, `Bun.markdown.html`, etc.
- Tests: `bun:test`. Filename must match `*.test.ts` for auto-discovery.
- **Requires `ripgrep`** (`brew install ripgrep`): `ctx.fns.files.grep` spawns `rg --json` for
  .gitignore-aware search. Without it grep falls back to an in-process scan and says so, loudly,
  in every result — so a missing `rg` is visible to the agent and the user rather than silent.

## The procs contract (calling convention)

- **`ctx.fns` is an injecting Proxy**: `ctx.fns.mod.fn({ ...opts })` calls the raw fn as `raw(ctx, ctx.session, opts)`. Callers NEVER pass ctx.
- Every function file: `export default [async] function (ctx: Context, session: Session | null, opts: {...})` — **anonymous**, one per file, folder = namespace. Zero-arg fns take `(ctx, _session, _opts?: {})`, called as `ctx.fns.mod.fn({})`.
- **No cross-imports between project files** — call through `ctx.fns`. `import` only from `bun`, `node:*`, npm. This is what makes hot reload work.
- State lives on `ctx.state` under the module's own name. Never in module-level variables.
- Types are global via auto-generated `src/ctx_ns.d.ts` (never edit): `mod/Name.ts` (capitalized noun) → `types.mod.Name`; `Context` from `src/Context.ts`, `Session` from `src/Session.ts`. Never `import type` project types.
- The framework's own modules live under `ctx.fns.procs.*` (`procs.db`, `procs.http`, `procs.repl`, `procs.dev`, `procs.events`, `procs.config`, `procs.log`, `procs.migrate`, …) and can't be shadowed. Full contract: upstream `PROCS.md`.

## File-name grammar ($-prefix = parsed by the scanner)

| file | becomes |
|---|---|
| `mod/fn.ts` (verb, lower-case) | `ctx.fns.mod.fn` |
| `mod/Name.ts` (noun, capitalized) | `types.mod.Name` (compile-time only) |
| `mod/$route_<path>_<METHOD>.ts` | route; `_`→`/`, `$id`→`:id`; handler `(ctx, session, { req, params })` |
| `mod/$middleware[_<path>].ts` | middleware under that prefix |
| `mod/$start.ts` / `$stop.ts` | lifecycle, in `package.json procs.prod` order |
| `mod/$config.ts` | config schema → `ctx.fns.procs.config.resolve({ module })` |
| `mod/$migration_<id>.ts` | db migration (`{up, down?}`), applied by `procs.migrate.up` in id order |
| `mod/$setting_<key>.ts` | declared runtime setting (owned by `settings/$loader_setting.ts`) → `ctx.state.settings.registry` |
| `mod/$script_<n>.js\|css` | browser asset, bundled, served at `/mod/<n>.js` |
| `mod/$cli_<cmd>.ts` | CLI command (`bun script/cli.ts <cmd>`) |
| `$main.ts` · `$test.ts` · `*.test.ts` · `*.entry.ts` · `*.d.ts` | skipped by the scanner |

## Layout

```
src/
  $main.ts            procs boot (makeCtx + injecting Proxy) — entry
  $test.ts            testCtx for bun tests (root defaults to this repo)
  Context.ts          global Context type (framework)
  Session.ts          global Session type (request session — NOT the agent transcript)
  ctx_ns.d.ts         AUTO-GEN by ctx.fns.procs.dev.genTypes
  procs/              VENDORED framework — ctx.fns.procs.* (patched: .hyper overlay
                      root in modules/discover, _migrations name→id compat, WAL)
  agent/              native JSON tool-call loop: run, workerLoop, wireTools,
                      routes /agent/:id*, $start.ts (loadAll + workerLoop), SYSTEM_PROMPT_CORE.txt
  session/            DB-first agent persistence (agents/messages/events) + $migration_*.ts
  llm/                stream dispatch by "provider:model" + OAuth refreshers + streamMock
  files/ ui/ markdown/ git/ settings/ events/ dev/ skill/ tools/
script/repl.ts        external REPL client (reads .runtime/port + .runtime/repl-token)
.runtime/             port, repl-token, signing key, bundled scripts (gitignored)
.hyper/               runtime-writable overlay — scanned AFTER src/, overrides by name;
                      _runtime/sessions is the LEGACY sqlite file (storage is Postgres now)
```

## Server, REPL, hot reload

Long-running server in tmux session `hyper` on **PORT 3010** (`bun run start`; :3000 is a different project).

```bash
tmux new-session -d -s hyper 'cd ~/hyper-code2 && bun run start'

bun script/repl.ts 'ctx.fns.session.list({})'          # eval inside the live process
bun script/repl.ts -f /tmp/play.js                     # from file; stdin works too
```

- `POST /procs/repl` is gated: run-signed JWT in `.runtime/repl-token` (0600) + loopback-only + 403 in production. `script/repl.ts` handles the token automatically.
- REPL eval is Jupyter-style: `console.log`/`print` captured, last expression returned.
- Hot reload: `ctx.fns.procs.dev.sync({ rel: "agent/run.ts" })` picks up an edited file (any kind); `ctx.fns.procs.repl.load({ name: "agent.run" })` swaps one fn or a module; `ctx.fns.procs.dev.genTypes({})` regenerates types; `ctx.fns.procs.http.loadRoutes({})` rescans routes; `ctx.fns.procs.migrate.up({})` applies new migrations. The dev **watcher** does sync automatically on save (dev only; `WATCH=0` opts out).
- Needs a restart: `$main.ts`, any `$start/$stop`, and long-lived closures (notably `workerLoop`) — reload swaps the fn but the old promise keeps spinning.
- Introspection: `ctx.fns.procs.dev.doc({ name: "agent.run" })`, `ctx.fns.procs.dev.where({ name })`, `ctx.fns.procs.dev.lint({})`.

## Database & migrations

- **Storage is Postgres** (paradedb via `~/.hyper/docker-compose.yml`, container `hyper-db`, port **54393**, db/user/pass `hyper`). Start with `cd ~/.hyper && docker compose up -d`.
- `ctx.fns.procs.db.*` — ALL ASYNC: `select({sql, params})` → rows, `run({sql, params})` → `{changes, lastInsertRowid: 0, rows}` (use RETURNING + `.rows` or `insert` for ids), `insert({into, values})` → `{id, changes}`, `exec({sql})` (multi-statement DDL, no params), `conn()` → Bun.SQL pool. `?` placeholders are translated to `$n` internally — keep writing `?`.
- NEVER use bare `Bun.sql`/`new SQL()` in app code — it defaults to localhost:5432, not our db.
- URL from `package.json procs.prod."procs/db".url` (env `DATABASE_URL` overrides). Pool `prepare: false` (Bun 1.3.14 pipelining bug — don't remove).
- Postgres dialect notes: ms-timestamps are BIGINT (come back as strings — wrap in `Number()`), `COUNT(*)` is bigint-string too, camelCase aliases need quotes (`AS "createdAt"`), `GREATEST` not scalar `MAX`, `ILIKE` not `COLLATE NOCASE`.
- Tests: each test ctx gets a private **pg_temp** schema on a one-connection pool (self-cleaning); pools are closed per-file by `src/_testPreload.entry.ts` (bunfig `[test].preload`). `max_connections=1000` on the container. CI runs a paradedb service.
- Migrations: `mod/$migration_<id>.ts` default-exporting `{ up(ctx), down?(ctx) }` (async), tracked in `_migrations(id)`. Ids are `YYYYMMDDHHmmss_name`.
- One-shot sqlite→pg data copy: `script/migrate-sqlite-to-pg.ts` (already run; old file kept at `.hyper/_runtime/sessions`).

## Agent (unchanged core design)

- **Native JSON tool calls** — providers receive schemas from the `$tool_*.md` registry; `agent.run` persists assistant `tool_calls`, validates arguments through `tools.call`, and appends `role='tool'` results. There is no text-marker parser in the active agent loop.
- The native `eval` tool typechecks its JSON `code` argument against the live project with an in-process TypeScript Language Service before execution. Toggle globally with declared setting `repl.typecheckEval` / env `EVAL_TYPECHECK`; internal callers can override one call with `typecheck: false`.
- Multi-agent at `ctx.state.agent[id]` (runtime view; **DB is source of truth**). Mutate transcript/events via `ctx.fns.session.append*/replace*/syncAgentState` — never `.push()` directly in runtime code.
- Queue: `agents.next_run_at` + `run_state` + `last_processed_msg_idx`; single in-process `workerLoop` claims atomically (`UPDATE … RETURNING id`), started by `agent/$start.ts`.
- Agent-visible behaviour lives in `src/agent/SYSTEM_PROMPT_CORE.txt`, composed by `fullSystemPrompt` with native tool schemas and compact tool guidance. Keep it in sync when conventions change.
- Forks: child stores `parent_id` + `fork_offset`; effective transcript via `ctx.fns.session.getFullMessages({ id })` — never copy transcripts.

## Testing discipline

- `bun test` (436+ tests) and `bunx tsc --noEmit` must both be clean.
- Shared fixture: `mkTestCtx()` from `src/_testCtx.entry.ts` — boots the real registry (full Proxy ctx, `:memory:` db, migrations, routes), scrubs env for determinism, and stubs `markdown.highlight/render` + `repl.eval`. Override stubs via `ctx.state.registry.<mod>.<fn> = (_c, _s, opts) => …` (raw signature!).
- Route tests go through `ctx.fns.procs.http.dispatch({ method, url, body, headers })` → real `Response`.
- **All tests use `model: 'mock:*'`** (`streamMock`; drive via `agent.scratchpad.mockLLM` — `echoUser`/`userText`/`defaultText`). Never hit real LLM providers in the suite.
- Fixtures go to `.test-tmp/` (gitignored) — NEVER into `src/` or `.hyper/` (both are scanned roots).
- **Test against a controlled environment, not live machines.** Anything that talks to an external system (SSH hosts, databases, browsers, HTTP services) gets a disposable fixture — preferably Docker — that the test starts, seeds and tears down itself. Never make the suite depend on the user's servers, `~/.ssh`, real accounts or network state. Example: `test/ssh/` (Dockerfile + compose + `fixture.ts`) spins up two throwaway sshd containers for `src/remote/remote.test.ts` and points the ctx at a private ssh_config via `HYPER_SSH_CONFIG`/`HYPER_SSH_CONTROL_DIR`. Such suites `describe.skipIf(!dockerAvailable)` so a machine without Docker skips instead of failing; `HYPER_SKIP_DOCKER_TESTS=1` skips them explicitly.
- Run test files by explicit path (`bun test ./src/remote/`), not as a bare filter (`bun test src/remote`): a filter makes bun scan the whole tree, including `harnesses/`, and the thousands of open descriptors make `Bun.spawn` fail with `EBADF`.

## Core code placement

**Nothing the app depends on may live in `.hyper/`** — it's the gitignored runtime overlay for agent-written extensions. Core features/migrations/routes/types go under `src/`. The scanner skips `_runtime`, `_test_*`, `_tmp_*`, `tmp_*`, `node_modules` segments.

Vendored `src/procs/` is upstream code: keep local patches minimal and marked with a `hyper-code2:` comment; prefer fixing upstream and re-vendoring.

## Secrets

- **Read secrets with `ctx.fns.secrets.get({ ref })`, never `secrets.resolve`.** `get` is
  the door: process memory → the encrypted `local_secrets` table → 1Password only on a
  miss, and it persists what it fetched. `resolve` is the bottom layer and *always* spawns
  the `op` CLI, so it fails whenever the vault is locked — which is exactly what happens at
  boot, after a reboot, with nobody there to approve a prompt. The tunnel went dark this
  way and the UpToDate login broke the same day.
- References are `env://NAME`, `op://vault/item/field`, or `secret://namespace/name` for
  values written by `secrets.set` / `secureInput.prompt({ saveAs })` (local only, never
  bootstrapped from a provider).
- Guarded on both sides: `src/secrets/callers.test.ts` fails the suite if anything under
  `src/` or `plugins/` calls `secrets.resolve`, and `resolve` itself logs
  `secrets.resolve.direct` naming the caller — that one covers out-of-tree plugins in
  `~/.hyper/user`, which no repository test can see.
- A secret never reaches a log, an error message, a tool result or the transcript. Errors
  say that a secret could not be resolved, not which one or why.

## What NOT to do

- Don't use npm packages where a Bun built-in exists.
- Don't import project files across module boundaries; don't name default exports.
- Don't pass `ctx` at call sites (`ctx.fns.x.y(ctx, …)` is the OLD convention — the Proxy injects it).
- Don't mutate `agent.messages`/`agent.events` directly in runtime code — session helpers only.
- Don't rename `ctx.fns.agent.run` / `workerLoop` carelessly.
- Don't edit `src/ctx_ns.d.ts` (generated) or add files under `src/procs/` for app features.

## UI frame (workspace-style)

- Layout (`src/ui/layout.ts`): TWO regions — the persistent agents rail on the left, and ONE page in `#main` on the right. An agent is an ordinary page (`GET /agent/:id` renders `ui.chatColumn` + `ui.agentMetaPanel`), so `/llms` or `/files` replaces it completely; the layout owns no current agent and keeps no hidden chat alive. Rail links swap `#main` in place (`hx-get` + `hx-push-url`), so the rail keeps its scroll while the page changes.
- **No htmx attributes on containers that hold content.** htmx inherits `hx-target`, `hx-swap` and `hx-push-url` into every descendant, and `#main` is full of fragments that poll for themselves (chat tail, status bar, meta panel). Navigation attributes live on the things that navigate — rail links, palette rows. Self-refreshing fragments say `hx-target="this"` out loud (`ui.live` emits it by default); a fragment whose response is not UI says `hx-swap="none"`.
- **Navigation is the ⌘K palette**, uniskill-style: no menu bar. `ui.navMenu` (island at the end of `<body>`) over `GET /nav/items` — pages and module pages first, then agents; the rail header's ☰ button and ⌘K both open it. Mount a module → its top-level GET pages become reachable, no tab to add. ⌘J/⌘K step to the neighbouring agent through `GET /agent/:id/next` (the server owns the order), swapped into `#main`.
- The chat client (`/agent/chat.js`) loads once and mounts on `#chat-panel` after every swap — Enter-to-send, stick-to-bottom, older-message paging and the tool cards all hang off that id.
- **The agents rail** (`ui.agentsRail`, served by `GET /ui/rail`): a one-line placeholder in the layout that loads itself and re-fetches every 10s + on the `rail-refresh` custom event — the layout never awaits the agent list. Agents are grouped by `workspace_dir` (the folder is the project); each row is a running light (`run_state`), the title with the id in brackets, and a WhatsApp-style **unread badge** — assistant messages past the `seen:<id>` watermark in `kv`. The watermark moves when the chat renders (`ui.chatColumn`) and on every open-chat poll (`agent/$route_$id_events.html_GET`): an open chat never accumulates unread. The header's archive toggle (state in `localStorage`, sent via `hx-vals js:`) shows archived agents dimmed with an unarchive button (`POST /agent/:id/unarchive` → `session.unarchive`). The "+" opens the new-agent form as an overlay (`GET /agent/new?popup=1` → `#modal`): full form — model (preselected from `kv last-model`, written on every create), workdir with live directory autocomplete (`GET /agent/dirs?q=`), base prompt, presets, custom instructions.
- **The chat header** names THIS agent only (title, id, model badge, statusbar) plus ⓘ/archive/delete icons — switching and creating live in the rail. The stop button exists only while something runs: it renders inside the statusbar fragment (1s poll) when `run_state`/`next_run_at` say busy.
- **Toasts are agent-scoped**: `ui.notify({agentId})` rides the event; the client (ui/controlScript) drops toasts whose agentId differs from `document.body.dataset.agentId`. Toasts without an agentId stay global.
- `GET /agent/:id` is the agent's overview/passport page (right pane) and sets the current agent.
- ⌘K palette (`ui.navMenu` island + `nav.items` + `GET /nav/items`): agents, built-in pages, and every mounted module's top-level GET pages. Module tabs come from procs modules metadata (`m.tab`), uniskill-style: mount a module → it shows up in nav.
- **Files UI** (`GET /files`, implementation and route contract in `docs/files-ui.md`): centered GitHub-style directory browser with relative and absolute breadcrumbs, text Code/Edit tabs, Markdown/HTML preview, and browser-native image/video/audio/PDF preview through `GET /files/raw`. To visibly open a file from server code, call `ctx.fns.ui.openFile({ path })`; `ctx.fns.files.open({ path })` only maintains open-file state and is not browser navigation.

## Transcript storage invariants

- `events.idx` / `messages.idx` are per-agent, contiguous, and allocated INSIDE the insert (`SELECT COALESCE(MAX(idx),-1)+1 … RETURNING idx` with a jittered retry on duplicate — `session/appendEvent.ts`, `appendMessage.ts`). Never allocate an idx with a separate SELECT: two overlapping appends (a stop's error event against a running turn's tool events) collide on the pkey.
- Tool-call cards in the transcript age out client-side (open → one line → tucked circle in a tray); an ERRORED call keeps its red tint but tucks like the rest — only a human click pins a card.

## screen & tour (ported from health-workspaces)

- `ctx.fns.screen.*` drives the tab the person already has open — no browser in
  the process: `screen.eval` pushes code down the SSE stream, the tab answers at
  `POST /screen/result` (handler in ui/controlScript). Verbs: `open` (partial
  nav into #main) · `click` · `fill` · `submit` · `point` (pointer+ring+caption)
  · `say` · `readScreen` (the data-* catalogue) · `text` · `where` (last beacon,
  no round trip).
- Targets are addressed by `procs.ui.attr` data-* markers (page/entity/id/form/
  action/role), NEVER CSS selectors. Seeded so far: the rail's menu button
  (action: open-menu), chat form (form: chat), agent picker (role), search page/form/hits,
  agent passport (page: agent + fork/archive/delete actions). New UI should
  carry markers from birth.
- `ctx.fns.tour.play({steps})` — scripted walk (Back/Next/Show me); `tour.review`
  checks steps against pages with no browser; `screen.step` — live tour, one
  step per turn; the person's press comes back through the `screen.press` hook
  → `agent/$hook_screen.press.ts` drops "[tour] the user pressed …" into the
  CURRENT agent's queue.
- The pointer/tour CSS lives in the framework sheet — the layout links
  `ctx.state.procs.styles` (procs/styles/app.css); don't remove that link.

## UI script routes

- `$script_*.js` files are served as bundled browser assets by `procs/http/$loader_script.ts`, not as fns. After changing one, `ctx.fns.procs.http.loadRoutes({})` (or dev.sync) and verify the actually served HTTP output (e.g. `/agent/chat.js`), including `.hyper` overrides — not just the file on disk.
- The app layout is `src/ui/layout.ts` (procs `toResponse` picks `registry.ui.layout` over the framework default). String / `{main, title}` returns from routes are wrapped by it; `Response` passes through.

## Git helpers

`ctx.fns.git.run/stage/commit/push/status/stageCommitPush({ ... })` — use these from agent code instead of ad-hoc shell (they handle `$`-filenames and take an optional `dir` for temp-repo tests).


## UI: HTMX first

The browser UI is server-rendered HTML with HTMX. Do not add Datastar, Alpine, React, or a second reactive/runtime layer without an explicit architecture migration.

Choose the smallest mechanism in this order:

1. **Native HTML/CSS** for local state and behaviour: `<details>`, `<dialog>`, forms, validation, focus, hover.
2. **HTMX** for anything that reads or writes server state: forms, fragment loading, lazy details, paging, and live-region refreshes.
3. **Small delegated JavaScript** only for transient browser behaviour HTML/HTMX cannot express cleanly: chat scroll anchoring, Enter-to-send, unsaved row reordering/removal, panel resize.

Rules:

- Server templates are the single source of markup. Never duplicate a row/card template in browser JavaScript.
- Prefer ordinary named form controls and `FormData.getAll()` over hidden JSON assembled on submit.
- A `+` that adds server-defined markup should be `hx-get` + `hx-swap="beforeend"`.
- The shell owns one permanent popup `<dialog>`. Procedural popup partials use only `hx-popup="module.function"` and optional `hx-popup-params='{"key":"value"}'`; the extension owns `/rpc`, target and swap. Do not add `hx-post`, `hx-rpc`, `hx-target`, `hx-swap`, local dialogs or manual fetch to popup triggers/forms.
- Live state uses `ui.live`: Postgres is authoritative, SSE topics invalidate, HTMX fetches current HTML. Keep topics narrow (`agent:<id>`, `agent-meta:<id>`, `agents`).
- Browser scripts must use event delegation when their targets can be replaced by HTMX. Do not bind/re-mount handlers on every fragment swap.
- Do not use JavaScript `fetch()` where an HTMX attribute describes the same request and swap.
