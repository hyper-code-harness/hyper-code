# Projects and memory

**Status:** implemented — four levels under `~/.hyper`, `memory.*`, functions of the levels with access
checks in `/rpc`, the code index and the prompt block. Search across levels,
backup and publishing are not built yet — see [Not done yet](#not-done-yet).

## Why

An agent's knowledge used to live only in its transcript. After a compaction, a fork or a fresh chat it was
gone: decisions, the person's preferences, facts about machines, scripts it had written. Memory keeps them
outside the transcript, on the level of whoever needs them later.

## The model: four levels × three kinds

| level | who sees it | files (`memory.write`) | functions | records (`memory.put`) |
|---|---|---|---|---|
| **system** | everyone on the instance | `~/.hyper/memory/` | `ctx.fns.<mod>` — `src/`, plugins | `visibility = system` |
| **user** | one person and all of their agents, in every project and without one | `~/.hyper/memory/users/<uid>/` | `~/.hyper/src/user_<uid>/` → `ctx.fns.user_<uid>.<fn>` | `user` + `user_id` |
| **project** | agents and people of the project | `~/.hyper/memory/projects/<slug>/` | `~/.hyper/src/project_<slug>/` → `ctx.fns.project_<slug>.<fn>` | `project` + `project_id` |
| **agent** | one agent (and its person) | `~/.hyper/memory/agents/<id>/` | `~/.hyper/src/agent_<id>/` → `ctx.fns.agent_<id>.<fn>` | `agent` + `agent_id` |

An agent sees four layers at once: system, its person (`agents.created_by`), its project and itself. A key
present on several levels resolves nearest first: agent → project → user → system. `~/.hyper` is
`HYPER_HOME` when that is set (tests use a temporary one).

User ids may contain `.` and `-`, which module names cannot: the module of `m.rijikov` is
`user_m_rijikov` (`memory.userModule`, reverse lookup `memory.fnLevel`).

### Why under ~/.hyper and not in the repo

Decided 2026-10-17 after weighing both (canvas "Память: репо или ~/.hyper"). Memory is written often and in
small pieces by agents while only people commit, so in a repo it would sit uncommitted and mix with other
people's changes; it holds things about people and machines that do not belong in a PR; projects on SSH
hosts could not use it; and the people of a team share one instance anyway, so they see the same project
memory without git. The price — memory does not travel with the repo and is not reviewed — is paid by an
explicit step: what has matured is **published** through a normal commit (a note into `docs/` or
`AGENTS.md`, a function into `src/` or a plugin), like `CLAUDE.md` next to `~/.claude`.

### Which level, which kind

- Level by who needs it later: the person's preference or habit → **user**; a decision, fact or convention
  of the project → **project**; the agent's own working state → **agent** (default); **system** only when the
  instance owner asks.
- Kind: prose someone reads and edits → a **file**; many similar items you filter → **records**; code that
  will run again → a **function**, never a snippet in a note.

## Projects

A project is a row in `projects`:

| column | meaning |
|---|---|
| `id` | short sequential id (`a`, `b`, …), counter in `kv` key `project:idCounter` |
| `slug` | unique lowerCamelCase name, `^[a-z][A-Za-z0-9]{0,62}$`; later names project functions (`ctx.fns.project_<slug>`) |
| `title` | human title |
| `default_dir`, `default_host` | the project folder, local or on an SSH host |
| `created_by`, `created_at`, `updated_at`, `archived_at` | bookkeeping |

`agents.project_id` attaches an agent (FK, `ON DELETE SET NULL`). An agent in a project works in
the project folder: `agent.start({ projectId })` and `project.assign` set the workspace to
`defaultDir`/`defaultHost`. The project is **not inherited** by forks or delegated children — this
was a deliberate choice; attach them explicitly when needed.

| function | does |
|---|---|
| `project.create({ slug, title, defaultDir, defaultHost? })` | new project; validates slug, absolute path, existing local folder |
| `project.get({ id \| slug })` | one project or `null` |
| `project.list({ includeArchived? })` | projects with agent counts |
| `project.assign({ project, agentId?, keepWorkspace? })` | attach (workspace → `defaultDir`) or detach with `project: null` |
| `agent.start({ ..., projectId })` | new agent already in the project folder |

## The memory table

One table, `memory`, indexes all three kinds on all four levels. For files and functions the file is the
source of truth; the row holds what is needed to find and judge it.

| column | meaning |
|---|---|
| `visibility` | `system`, `user`, `project` or `agent` |
| `user_id`, `project_id`, `agent_id` | the owner of the level (CHECKed) |
| `key` | path inside the level folder (`notes/canvas-model.md`), record key (`todo/x`), or `fn/<module>.<fn>` |
| `type` | `file`, `code` or `jsonb` |
| `kind` | free-form: `decision`, `preference`, `fact`, `todo`, `function`, … |
| `title`, `description` | one line each; `list` shows them as the table of contents |
| `url` | absolute `file:///…` of the file; `null` for jsonb |
| `meta` | `hash`, `size`, `source.agentId`, `status`; for functions also `name`, `params`, `returnType` |
| `data` | jsonb content for `type = jsonb` |
| `version`, `created_*`, `updated_at` | bumped on every write |

Unique per level owner: `(visibility, project_id, user_id, agent_id, key)`.

## Functions

- **Write** the file with the write tool — same grammar as `src/<mod>/<fn>.ts` (`export default async
  function (ctx, session, opts)`, JSDoc). `procs.dev.createFunction` is for `src/` only.
- **Load.** `procs/modules/discover` mounts `~/.hyper/src` as root `memorySrc`; `procs/project/scan` takes only
  `user_*/`, `project_<slug>/` and `agent_<id>/` folders from it. `procs/dev/watch` watches it: a save
  reloads the module, regenerates types and runs `memory.syncCode` — no manual `genTypes`/`repl.load`.
- **Index.** `memory.syncCode({})` upserts one `type = code` row per function, key `fn/<module>.<fn>`, on the
  level its folder names; title and description from the first JSDoc paragraph; `meta.status` starts
  `draft` and survives resyncs; rows of deleted files go.
- **Ready.** `memory.setStatus({ key: "fn/project_hyperDesign.tables", status: "ready" })` — refused unless a
  `<fn>.test.ts` is next to the file and the JSDoc has a summary. Ready functions (and all of the agent's own)
  are listed in the prompt block of every agent that may call them.
- **Promote** by moving the file (`agent_<id>/` → `project_<slug>/` or `user_<uid>/`); the call name
  changes and typecheck finds the callers. **Publish** to everyone by a commit into `src/` or a plugin.
- **Access.** `project.canCall({ name })` decides and `POST /rpc` answers 403 with its reason:
  `user_<uid>.*` — that person and their agents; `project_<slug>.*` — agents of the project and signed-in
  people; `agent_<id>.*` — that agent and its person (the instance owner for agents without a creator).
  Inside the process `ctx.fns` does not check — the boundary is the door, as for every other function.

## Safety

- Writers resolve the level with `memory.level`: `project` needs a project, `user` needs a person on the
  agent, `system` only for agents of the instance owner (role `owner`) — others propose.
- Readers go through one filter (`memory.scope` → `visibleSql`) and `memory.find`; `memory.file` reads only
  inside the folders of the caller's levels and never another person's, project's or agent's folder below the
  system root. Paths with `..` or absolute paths are refused on write.
- `stale: true` when a file changed outside `memory.*` (hash mismatch) or is missing.
- No secrets in memory — use `secrets.*`.

## What the agent sees

The core system prompt (`src/agent/SYSTEM_PROMPT_CORE.txt`) carries the table above and the rules. The
`agent.promptAugment` hook (`src/memory/$hook_agent.promptAugment.ts`) adds the facts for this agent — a
"Your memory" block: its id, project and person with their folders and entry counts, a pointer to
`notes/where-we-stopped.md` when there is one, and the functions it may call. It is sent again only when
it changes; agents started by another agent get it too (`syncWorldState` counts agent messages as the turn).

## Files

| file | what |
|---|---|
| `src/memory/$migration_20331016140000_memory.ts`, `…20331017100000_memory_levels.ts` | the table, then the four levels |
| `src/memory/{home,scope,level,find}.ts` | where memory lives, the visibility filter, level of a write, lookup |
| `src/memory/{write,put,list,read,file,edit,remove,setStatus}.ts` | memory helpers |
| `src/memory/{syncCode,fnLevel,userModule}.ts` | functions as memory |
| `src/project/canCall.ts` | who may call level functions from outside |
| `src/procs/modules/discover.ts`, `src/procs/project/scan.ts`, `src/procs/dev/watch.ts` | mounting and hot reload of `~/.hyper/src` |
| `src/memory/memory.test.ts`, `src/memory/functions.test.ts` | tests (15, ~1 s on the test db) |

## Not done yet

- Search across levels with the same filter: `runtime.docs.search` dropping other people's, projects' and
  agents' functions, and `memory.search` (bm25) over files and records.
- `memory.publish` (note → `docs/`), `~/.hyper/memory` as a git repo with auto-commit for history and backup,
  `memory.export/import` of a project between instances.
- `memory.sync` — re-index files edited outside `memory.*` (today `stale` is only reported).
- `memory.context({ task, tokenBudget })`, conflict detection between notes.
