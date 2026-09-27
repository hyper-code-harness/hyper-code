# hyper-code2

[![test](https://github.com/niquola/hyper-code2/actions/workflows/test.yml/badge.svg)](https://github.com/niquola/hyper-code2/actions/workflows/test.yml)

A self-extending AI agent server on Bun, running on the [procs](https://github.com/niquola/procs) framework (vendored at `src/procs/`). Procedural TypeScript, **markers protocol** instead of native tool-calls, an injecting-Proxy `ctx.fns` and a tokened external REPL into the live process.

The agent acts by emitting `§eval` / `§write:<path>` / `§bash` / `§html` markers in plain content. The runtime parses each marker, executes its body (JS/TS for eval, file write for write, `bash -c` for bash, TSX render for html), and feeds the result back as a synthetic user message on the next turn. No JSON tool schemas, no escape-in-escape, one wire format.

**State is separated from functions.** Behaviour lives in files under `src/` / `.hyper/` and is loaded into `ctx.fns.<module>.<fn>` — called as `ctx.fns.mod.fn({ ...opts })`, with `ctx` and the request `session` injected by a Proxy. Runtime state lives on `ctx.state` (in-memory) and Postgres (`agents`, `messages`, `events`, any table the agent chooses to add — paradedb, so transcripts are BM25-searchable). Replacing a file + `ctx.fns.procs.repl.load({ name: "<module>" })` (or just saving it — the dev watcher syncs) swaps the function everywhere without touching state or restarting the process — routes, procedures, types, even the agent loop itself can be extended live.

**All sessions are in Postgres and fully agent-accessible.** Every turn's messages and UI events for every agent are rows in the `hyper` Postgres (paradedb, `~/.hyper/docker-compose.yml`). The agent reads its own + other agents' history with a one-liner: `§eval\nctx.fns.procs.db.select({ sql: "SELECT … FROM messages …" })`. Useful for recalling prior work, mining patterns, or building custom indexes.

## External coding harnesses

The live runtime is available to trusted local Claude Code, Codex, and other shell-capable harnesses through the `hyper` CLI:

```sh
hyper plugin search "GitHub pull request review"
hyper function read gh.pr
hyper tools
hyper tool call find --json '{"path":"src","pattern":"*.ts"}'
hyper repl 'return await ctx.fns.gh.me({})'
hyper skills mount
```

The CLI provides live plugin/function discovery, schema-validated declared-tool calls, a separately-tokened loopback-only arbitrary REPL, and managed `hyper-*` skill links. See [External coding harnesses](docs/external-harnesses.md) for setup, commands, and the security model.

## Core applications

- **[Knowledge](plugins/knowledge/SKILL.md)** — typed entities, provenance and relations in the isolated `knowledge` schema; UI at `/knowledge`.
- **[News](docs/news.md)** — durable source-neutral archive, search, read/like state and keyboard slideshow; UI at `/news`.


## UI architecture: HTMX first

The UI is server-rendered HTML. Native HTML handles local behaviour, HTMX handles server interaction, and a small amount of delegated JavaScript is reserved for transient UX that cannot be expressed declaratively.

```text
Postgres write → narrow SSE invalidation topic → ui.live region → HTMX fragment GET → DOM swap
```

Conventions:

- use `<details>`, `<dialog>`, forms and native validation before JavaScript;
- use HTMX for form submits, lazy fragments, paging and live refreshes;
- render each fragment/row on the server only once—browser JS must not duplicate templates;
- submit repeated form controls with `FormData.getAll()` instead of constructing hidden JSON;
- keep JavaScript for scroll anchoring, keyboard shortcuts, resize, and local reorder/remove only;
- popup RPC uses the compact `hx-popup="module.function"` plus optional `hx-popup-params='{"key":"value"}'` contract; do not repeat transport/target/swap attributes or create local dialogs;
- do not mix Datastar or another reactive framework into the HTMX lifecycle.

Examples in the current UI: Plan `+` loads a server-rendered task row with HTMX; tool details and secure input call procedural partials through `hx-popup` into one permanent native `<dialog>`; chat and Meta refresh on separate live topics.

## What it is

A tiny HTTP server that hosts a multi-agent chat. Each agent has four markers it can emit:

| marker            | body                | result fed back                    | used for                                  |
| ----------------- | ------------------- | ---------------------------------- | ----------------------------------------- |
| `§eval`         | JS/TS              | captured `console.log` output      | **main action** — compute, call ctx.fns, query DB |
| `§write:<path>` | file contents       | "wrote N bytes"                    | dropping multi-line file content verbatim |
| `§bash`         | shell script        | stdout (or `[exit N]` + stderr)    | quick lookups: `ls`, `git`, `grep`, `head` |
| `§html`         | TSX fragment        | nothing (final answer)             | rich UI bubbles with Tailwind, interactive forms |

Through `§eval` the agent can:

- Compute anything via the Bun runtime — `Bun.file`, `Bun.write`, `Bun.$` shell, `bun:sqlite`, `Bun.sql`, `Bun.redis`, `Bun.s3`, `fetch`, `crypto`.
- **Read its own source** (`Bun.file("src/agent/run.ts").text()`).
- **Write new procedures** to `src/<module>/<fn>.ts` or `.hyper/<module>/<fn>.ts` and hot-reload them (`ctx.fns.procs.dev.sync({ rel })`) — no restart.
- Add new HTTP routes on the fly (`$route_*.ts` → `ctx.fns.procs.http.loadRoutes({})`).
- Mutate its own model, system prompt, scratchpad between turns.
- Compact its own history (`ctx.fns.agent.compact({ agent, … })`) when results grow too large.

Through `§html` the agent answers with **TSX**: full JS interpolation in `{expr}`, auto-escape, Tailwind classes inline, even `<form method="POST">` that sends the user's input straight back into the conversation. No template engine — JSX is the template engine.

## Architecture in one picture

```mermaid
flowchart LR
    subgraph Browser
        F[form hx-post]
        M["#messages + #msg-tail<br/>(long-poll, hx-trigger=load)"]
        S["#status-bar<br/>(every 1s)"]
        SB["#sidebar<br/>(every 10s)"]
    end

    subgraph Server["Bun process"]
        POST["POST /agent/:id"]
        EH["GET /agent/:id/events.html<br/>(long-poll, holds 25s)"]
        STAT["GET /agent/:id/statusbar"]
        WORKER["workerLoop<br/>(single, in-process)"]
        RUN["run<br/>→ LLM → parseMarkers → execute"]
    end

    subgraph DB[Postgres]
        AGENTS[(agents<br/>+ next_run_at<br/>+ run_state<br/>+ last_processed_msg_idx)]
        MSGS[(messages<br/>append-only<br/>+ excluded_from_cursor<br/>+ excluded_from_llm)]
        EVENTS[(events<br/>append-only)]
    end

    F      -- "appendUserMessage<br/>+ next_run_at = now+1s" --> POST
    POST   --> MSGS
    POST   --> AGENTS
    POST   -- "wakeWorker" --> WORKER
    WORKER -- "atomic claim<br/>UPDATE … RETURNING id" --> AGENTS
    WORKER --> RUN
    RUN    -- "appendEvent<br/>(per token-batch)" --> EVENTS
    RUN    --> MSGS
    EVENTS -- "wakeWaiters" --> EH
    M      -- "/events.html?offset=N" --> EH
    EH     --> M
    S      -- "/statusbar" --> STAT
    STAT   --> AGENTS
    SB     -- "x-hyper-fragment: sidebar" --> Server
```

**DB-first.** The DB is the source of truth for messages, events, and run state. Browser drives long-poll + status/sidebar polls — no JSON polling for chat, no SSE for data. Client JS is ~30 lines (Enter-key + scroll-on-swap). Full spec: [`docs/architecture.md`](docs/architecture.md).

**No queue table.** "When should this agent run next?" lives on `agents.next_run_at`; "is it running right now?" on `agents.run_state`. POST writes one message + bumps `next_run_at`; the worker atomically claims via `UPDATE agents … RETURNING id` and processes everything since `last_processed_msg_idx` in one pass. Synthetic `§result:*` user-messages emitted by `run()` itself are tagged `excluded_from_cursor=1` so they don't look like fresh input — only real user POSTs schedule the next run.

**Settings.** Declared key/value store in `src/<mod>/$setting_<key>.ts`. Resolution chain: explicit caller input → DB row → declared `env` binding → declared `default` → caller fallback. Shipping declarations: `llm.defaultModel`, `agent.debounceMs`, `agent.protocol`, `provider.{baseUrl,apiKey}` for each LLM backend, plus per-provider api-key declarations.

## Conventions (procs, one thing per file)

- **`src/<mod>/<fn>.ts`** (verb, lower-case) → `ctx.fns.<mod>.<fn>`; default export is an anonymous `(ctx, session, opts)` function, called with opts only: `ctx.fns.mod.fn({ ... })`.
- **`src/<mod>/<Name>.ts`** (noun, capitalized) → `types.<mod>.<Name>` global type via `procs.dev.genTypes`. No `import type` of project types anywhere.
- **`src/<mod>/$setting_<key>.ts`** → declared runtime setting (`{ type, default, env, options, … }`) → `ctx.state.settings.registry`.
- **`src/<mod>/$route_<path>_<METHOD>.ts`** → HTTP handler `(ctx, session, { req, params })`. `_` = `/`, `$param` = `:param`.
- **`src/<mod>/$migration_<id>.ts`** → Postgres migration (`{ up, down? }`), applied at startup in id order.
- **`src/<mod>/$script_<name>.js`** → browser asset, bundled, served as `/<mod>/<name>.js`.
- Plus the rest of the procs grammar: `$middleware`, `$config.ts`, `$start/$stop`, `$cli_*`, `$loader_*`, `$point_/$hook_` — see `AGENTS.md`.

No cross-imports between project files — call other procedures via `ctx.fns`. `import` only from `bun`, `node:*`, npm. `.hyper/` mirrors `src/` and loads after it; gitignored, runtime-writable. The framework itself is `ctx.fns.procs.*` and can't be shadowed.

## Layout

```
src/
  $main.ts                        procs boot: makeCtx (injecting Proxy) → loadFns → genTypes → loadRoutes → lifecycle.start
  $test.ts                        testCtx for bun tests (full registry, per-ctx pg_temp schema, no server)
  Context.ts / Session.ts         global framework types
  ctx_ns.d.ts                     AUTO-GEN by procs.dev.genTypes — never edit
  $route_GET.ts                   GET /  — redirect to the latest agent

  procs/                          VENDORED framework — ctx.fns.procs.*
    boot/ http/ repl/ db/ dev/ config/ log/ migrate/ events/ lifecycle/
    auth/ cli/ modules/ project/ styles/ ui/ hooks/ generate/ env/
    (local patches marked `hyper-code2:`: .hyper overlay root, _migrations
     name→id compat, WAL on file DBs)

  agent/                          ctx.fns.agent.* — the markers-protocol runtime
    SYSTEM_PROMPT_CORE.txt        invariants + map of ctx.fns (teaches the new calling convention)
    SYSTEM_PROMPT.txt             markers wire-format with full HTML/TSX examples
    run.ts                        turn loop — stream → parse → execute markers → feed results
    workerLoop.ts / $start.ts     single in-process drainer, started by lifecycle
    parseMarkers / executeMarker / compact / delegateTask / finishTask / …
    $route_*.ts                   /agent/:id (POST/GET), /events.html (long-poll), /statusbar, /fork, /archive ...

  session/                        ctx.fns.session.* — DB-first persistence
    append* / replace* / truncate* / get* / save / load / loadAll / fork / …
    $migration_*.ts               schema evolution (ids preserved from the SQL era)

  llm/                            ctx.fns.llm.* — stream dispatch + OAuth refreshers + streamMock
  settings/                       ctx.fns.settings.* — DB-backed runtime settings ($loader_setting.ts)
  files/                         ctx.fns.files.* + GET /files — GitHub-style browser, editor, media preview (docs/files-ui.md)
  ui/ markdown/ git/ dev/ events/ skill/ tools/

.runtime/                         port, repl-token (0600), signing key — gitignored
.hyper/                           runtime-writable overlay, gitignored
  _runtime/sessions               legacy sqlite file (storage is the hyper Postgres, ~/.hyper/docker-compose.yml)
  <agent-generated>/              whatever the agent decides to add

script/
  repl.ts                         external REPL client → POST /procs/repl (port+token from .runtime/)
  cli.ts                          $cli_* commands runner

AGENTS.md                         project conventions consumed by tooling and any agent that asks
```

## Markers protocol

Body of any marker spans from the line **after** the marker to the **next** marker line at column 1 (or end of message). No closing delimiter. Examples emitted by the agent (each is one full assistant reply):

```
§eval
const pkg = await Bun.file("package.json").json();
console.log(pkg.name, Object.keys(pkg.dependencies ?? {}).length, "deps");
```

```
§bash
ls -la src/agent | head -10
git log --oneline -3
```

```
§html
<div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
  <h3>{agent.scratchpad.user.name}</h3>
  <ul>{agent.scratchpad.items.map(i => <li>{i}</li>)}</ul>
</div>
```

After the runtime executes, the next turn's transcript shows `assistant: §eval\n<code>` directly followed by `user: §result:eval\n<stdout>`. Markers can be chained in one reply — each gets its own assistant + result pair, so the model sees crisp call→result alignment.

If the model glues a marker to preceding text without a leading `\n` (`текст.§eval\n…`) the parser executes it anyway and attaches a `§error:marker-misplaced` warning so the model self-corrects on the next turn — no wasted turn. To put a literal `///marker` in prose, escape with four slashes (`/§eval` → renders as `§eval`) or break the slashes (`/./eval` is content, doesn't match the regex). See [`src/agent/SYSTEM_PROMPT_CORE.txt`](src/agent/SYSTEM_PROMPT_CORE.txt) for the full agent-facing spec, [`src/agent/parseMarkers.ts`](src/agent/parseMarkers.ts) for the implementation.

## Quick start

```bash
# 1. install (requires Bun >= 1.3.13)
bun install

# 2. point at an LLM provider — pick one of:
#    - LM Studio: cp .env.test .env  (LMSTUDIO_URL=http://localhost:1234, MODEL=…)
#    - Anthropic API key: ANTHROPIC_API_KEY=sk-ant-…
#    - Claude Code subscription: nothing — refreshClaudeCode pulls the token from macOS keychain
#    - Codex (ChatGPT subscription): codex login
#    - Kimi: KIMI_API_KEY=… or KIMI_CODING_API_KEY=… or kimi login

# 3. run
tmux new-session -d -s hyper 'cd $(pwd) && bun run start'

# 4. chat
open http://localhost:3010/
```

## LLM providers & auth

Models are addressed as `<provider>:<model-id>`. The prefix picks the endpoint and protocol; the API key is pulled from a declared setting (`llm.<provider>ApiKey`), an env var, or a local credentials file:

| prefix             | endpoint                             | auth                                                                      |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------- |
| *none* / `lmstudio:` | `LMSTUDIO_URL` (default `:1234`)   | none (local)                                                              |
| `openai:`          | `https://api.openai.com/v1`          | `OPENAI_API_KEY`                                                          |
| `anthropic:`       | `https://api.anthropic.com`          | `ANTHROPIC_API_KEY`                                                       |
| `claude-code:`     | `https://api.anthropic.com`          | OAuth from macOS keychain `Claude Code-credentials` (no API key needed)   |
| `kimi:`            | `https://api.moonshot.ai/v1`         | `KIMI_API_KEY` (Moonshot console key)                                     |
| `kimi-coding:`     | `https://api.kimi.com/coding`        | `KIMI_CODING_API_KEY` OR JWT from `~/.kimi/credentials/kimi-code.json`    |
| `codex:`           | `https://chatgpt.com/backend-api/codex` | OAuth from `~/.codex/auth.json` (ChatGPT subscription via codex CLI)   |
| `groq:`            | `https://api.groq.com/openai/v1`     | `GROQ_API_KEY`                                                            |
| `openrouter:`      | `https://openrouter.ai/api/v1`       | `OPENROUTER_API_KEY`                                                      |

All four subscription providers (`claude-code:`, `kimi-coding:`, `codex:`) read tokens fresh on each request, refresh via the matching OAuth token endpoint when within 60s of expiry, and write the new pair back so the official CLI keeps working.

`claude-code:` only exposes `claude-haiku-4-5-…` in the new-agent form. Sonnet/Opus are gated by Anthropic's per-model anti-fraud rule for non-CLI OAuth clients (429 with no usage to spend); use `anthropic:claude-…` with an API key when you need them.

## REPL workflow

Long-running server in tmux session `hyper` (port 3010). Boot = procs lifecycle: log → db → migrate → repl → agent (loadAll + workerLoop) → http. Everything is iterable without restart.

`POST /procs/repl` is **gated three ways**: a JWT this run signs (mirrored to `.runtime/repl-token`, 0600), loopback-only (no proxies), and 403 under `NODE_ENV=production`. `script/repl.ts` reads the port and token automatically — so any local process (including a coding agent outside this repo) can drive the live server.

```bash
# start
tmux new-session -d -s hyper 'cd $(pwd) && bun run start'

# evaluate code
bun script/repl.ts 'console.log(1 + 1)'                            # quick eval (Jupyter-style)
bun script/repl.ts 'Object.keys(ctx.fns)'                          # introspect (last expression returned)
bun script/repl.ts -f /tmp/play.js                                 # from file
echo 'console.log(ctx.state.serverStart)' | bun script/repl.ts     # stdin

# hot-reload
bun script/repl.ts 'await ctx.fns.procs.repl.load({ name: "agent" })'      # whole namespace
bun script/repl.ts 'await ctx.fns.procs.repl.load({ name: "agent.run" })'  # single fn
bun script/repl.ts 'await ctx.fns.procs.dev.sync({ rel: "agent/run.ts" })' # pick up an edited file (any kind)
bun script/repl.ts 'await ctx.fns.procs.dev.genTypes({})'                  # regen ctx_ns.d.ts
bun script/repl.ts 'await ctx.fns.procs.http.loadRoutes({})'               # rescan routes
bun script/repl.ts 'await ctx.fns.procs.migrate.up({})'                    # apply new migrations

# introspect functions (C-h f / M-.)
bun script/repl.ts 'ctx.fns.procs.dev.doc({ name: "agent.run" })'
bun script/repl.ts 'ctx.fns.procs.dev.where({ name: "session.appendMessage" })'

# create a new agent + open it
bun script/repl.ts 'await ctx.fns.ui.createAgent({ model: "claude-code:claude-haiku-4-5-20251001" })'
```

REPL `eval` is **Jupyter-style**: `console.log` and `print` are captured, and the last expression statement is returned as a value. TypeScript is transpiled via `Bun.Transpiler`; top-level `await` works. In dev the **watcher** syncs every saved file automatically (`WATCH=0` opts out).

When you reload a function that holds a long-running promise (notably `workerLoop`), the new function lands in `ctx.fns` but the old promise keeps spinning in its closure. Restart the process for those — `tmux kill-session -t hyper && tmux new-session …`.

## Testing

```bash
bun test              # all tests (bun:test auto-discovers *.test.ts)
bunx tsc --noEmit     # type check — must be clean
```

All unit tests use `model: 'mock:*'` which routes through `src/llm/streamMock.ts`. Live integration tests for `streamOpenAI` are gated behind `LIVE_LLM=1` and **off by default**. `bun test` is deterministic and offline.

The shared test fixture is [`src/_testCtx.entry.ts`](src/_testCtx.entry.ts) — `mkTestCtx()` returns a fully-wired `ctx` with `:memory:` DB, migrations, all common `ctx.fns.*` populated, and the same `settingsRegistry` declarations as production.

## Why "procedural, not OO"

Inspired by [proc-ts](https://github.com/niquola/proc-ts). Consequences:

- **One file, one function, anonymous default export.** No classes, no base abstractions, no DI containers.
- **No cross-imports of project files.** Call other procedures via `ctx.fns.<ns>.<fn>({ … })` — names resolve at call time, which is what makes hot-reload actually work: swapping a file in the registry updates every call site instantly.
- **Types live next to code as capitalized files** (`agent/Agent.ts` → `types.agent.Agent`). Scanned into a single generated `ctx_ns.d.ts` with `declare global` — no imports of `Context`, `types.agent.Agent` at usage sites.
- **`$`-prefixed filenames carry intent.** `$main.ts` is the entry; `$start.ts`/`$stop.ts` are lifecycle; `$route_*.ts` is an HTTP route; `$setting_*.ts` is a declared setting; `$migration_*.ts` is a migration; `$script_*.js` is a browser asset; `$config.ts`, `$middleware`, `$cli_*`, `$loader_*` complete the grammar. Everything else is a plain function.

Optimised for an LLM-agent-driven codebase where the agent reads, writes, and hot-reloads files by itself.

## What's not here (by design)

- **No build step.** Bun runs TS/TSX directly.
- **No framework** (no Express, no Next.js, no Vite). `Bun.serve`, `Bun.file`, `Bun.markdown`, `bun:sqlite`, `bun:test`, `Bun.Transpiler` cover everything.
- **No npm equivalents** where a Bun built-in exists.
- **No native function-calling protocol.** Markers are the only wire format. Removed in favour of one escape level + uniform behaviour across providers.
- **No streaming tokens to the UI yet** — events appear once the LLM finishes. `/agent/:id/statusbar` polls every 1s so the user sees `running · 12.3s`.

## License

MIT.
