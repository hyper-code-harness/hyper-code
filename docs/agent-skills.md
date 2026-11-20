# Agent Skills

**Status:** implemented — the `skills` module (`src/skills/`). Off for ordinary agents until the switch on the
Skills page is turned on. Not built yet: update checks, skills in project memory, MCP — see [Not done yet](#not-done-yet).

The other direction — publishing Hyper's plugins as skills for Claude Code and Codex — is [skills.md](skills.md).

## What a skill is, and why it is not a plugin

A skill is a folder with a `SKILL.md`: YAML frontmatter (`name`, `description`) and Markdown instructions for
doing one kind of work — a review method, a test-first workflow, a document recipe — sometimes with reference
files and scripts next to it. The format is the open [Agent Skills specification](https://agentskills.io/specification);
skills written for Claude Code, Codex, Cursor and others are used as they are.

| | plugin | skill |
|---|---|---|
| is | code: functions in `ctx.fns` | text an agent reads and follows |
| lives in | `USER_PLUGINS` (`~/.hyper/user`), `plugins/` | `~/.hyper/skills/<pack>/`, shared folders |
| installed by | `plugins.install` | `skills.install` — a person only |
| lock | `~/.hyper/plugins.lock.json` | `~/.hyper/skills.lock.json` |
| loaded | by the module loader, at mount | never: an agent asks for one |

The two are separate on purpose. A pack of skills is cloned as it is and nothing in it is ever loaded as code:
the module loader does not look into `~/.hyper/skills`. The `plugins` module is not changed by any of this.

## Where skills come from

- **Shared folders**, read in place: `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` (setting
  `skills.roots`). Every direct child with a `SKILL.md` is a skill of the pack `local`. Hyper never writes
  there. The same folder reached by two paths counts once; links into Hyper's own plugins (what
  `external.mountSkills` publishes) are left out.
- **Packs**, installed from a git repository into `~/.hyper/skills/<pack>/` at a pinned commit. Which folders of
  the repository are skills is decided by the author's `.claude-plugin/plugin.json` (`skills`), then
  `.claude-plugin/marketplace.json`, then a walk of `skills/`, `.agents/skills/`, `.claude/skills/`.
- **Collections** to look into: `src/skills/HUBS.json` — the publishers' own repositories (Anthropic, OpenAI:
  trust `official`) and widely used community ones — and the public index skills.sh (`skills.hubSearch`).
  Popularity is shown, but it is not a safety check: the list leaves out repositories with almost no stars and
  millions of installs.

A full name is `<pack>:<name>`; the short name works while it is unambiguous.

## How an agent uses skills

Nothing about the installed skills is put into an agent's context in advance — there may be hundreds. An agent
with the `skill` tool gets one section in its system prompt (`skills.promptSection`, about 2800 characters,
the same for every agent, naming no skill) that says:

1. look for a mounted plugin first — `ctx.fns.plugins.search({ query })`;
2. then for an installed skill — the tool `skill({ query })` returns matches, `skill({ name })` loads one;
3. then outside — `ctx.fns.skills.hubSearch({ query })`, `ctx.fns.skills.preview({ repo })`;
4. a skill pack is installed only by the person: `ctx.fns.skills.propose({ repo, select, why })` opens a form
   in the chat and the agent ends its turn.

`skill({ name })` returns a `<skill_content>` block: the instructions without frontmatter, the skill's folder,
up to 30 file names, and a short note on how to read words written for other harnesses ("call the Skill tool
with X" is `skill({ name: "X" })`, a sub-agent is `agent.delegate`, …). `skill({ name, file })` reads one file of
a loaded skill. The result is kept whole up to 40 000 characters (`inlineLimit` in the tool declaration; other
tools are cut at 6000). A second load of the same skill answers with a pointer instead of a second copy.

A search lists what the agent can load first, and apart from it the skills only a person can start.

### Who may start a skill

| | the model, with the tool | a person, with `/name` |
|---|---|---|
| skill of a shared folder | yes | yes |
| pack with trust `official` | yes | yes |
| pack with trust `community` | after "Let agents pick it" | yes |
| skill with `disable-model-invocation: true` | no | yes |

`/name args` typed at the very start of a chat message loads that skill as its own transcript row
(`message_type: skill_invocation`) next to the message, which stays as typed; the rest of the message is the
argument and replaces `$ARGUMENTS`. The message box suggests skills after `/`. A message written by another
agent never starts a skill.

### Scripts

A skill may ship scripts. Hyper never runs them — not at install, not when the skill is loaded. The agent runs
them with its ordinary `bash`, by absolute path, when the instructions say so; the install preview and the
skill's page list every file that looks executable. Command injections (`` !`cmd` ``), `allowed-tools`, `hooks`
and `model` in a skill's frontmatter have no effect here and are named in the parser's diagnostics.

## What only a person can do

An agent may search, preview and propose. Installing, removing, allowing a pack to agents and turning skills on
for everybody are refused for any call that carries an agent session (`skills.personOnly`): the `skill` tool,
`eval`, a background eval. They happen in the person's own request — the chat form `skills.propose` opens, or a
button on the Skills page (`POST /skills/act`, same-origin and CSRF-checked).

This is a guard rail, not a sandbox: an agent with `bash` can still change files on the machine. The text of a
skill is an instruction to the agent; read it before installing.

## The Skills page

`/rpc/skills.page` (menu: Skills), also a canvas tab: `canvas.show({ args: { fn: "skills.page" } })`.

- the switch "Turn skills on for all agents" (`skills.enabled`);
- installed packs with Update, Remove and "Let agents pick it";
- shared folders;
- every skill with who may start it and how often it was loaded;
- collections to look into — a name opens `skills.previewPage`, which fetches the repository for reading
  (nothing is installed, no agent can load it) and offers Install per skill or for all.

`skills.view` shows one skill with every file of its folder — instructions rendered, scripts with line numbers
— the same for an installed skill and for one in a preview.

## Storage

| what | where |
|---|---|
| installed packs | `~/.hyper/skills/<pack>/` — a git clone, detached at the pinned commit |
| lock | `~/.hyper/skills.lock.json`: repository, tag or branch, commit, trust, `model`, a hash per skill |
| previews | `~/.hyper/.skills-staging/preview/<id>/`, removed after a day |
| search index | table `skill_docs`: one row per skill, BM25 and embeddings; the instructions are not stored |
| usage | table `skill_usage`: time, skill, agent, who started it — never message text |

`HYPER_HOME` replaces `~/.hyper` (tests use a temporary one).

## Functions

| function | does |
|---|---|
| `skills.search({ query })` | installed skills by what they are for |
| `skills.hubSearch({ query })` | skills that are not installed: skills.sh and the collections |
| `skills.hubs({})` | the collections |
| `skills.preview({ repo, select?, ref? })` | fetch a repository for reading |
| `skills.propose({ repo, select?, why? })` | open the install form in the chat |
| `skills.use({ name \| query, file?, offset? })` | what the `skill` tool calls |
| `skills.list`, `skills.resolve`, `skills.index` | the index |
| `skills.install`, `skills.uninstall`, `skills.allowModel`, `skills.setEnabled`, `skills.act` | person only |
| `skills.page`, `skills.view`, `skills.previewPage` | `@view` pages |

## Turning it on

The `skill` tool is declared opt-in, so an ordinary agent neither has it nor is told about skills. An agent
started with `tools: ["skill", …]` has it at once. The button on the Skills page sets `skills.enabled`: every
agent without a tool list of its own then gets the tool and the prompt section. That moves the cached prompt
prefix of every live session once.

## Not done yet

- checking installed packs for updates (the lock has what is needed; nothing reads it on a schedule);
- skills in project, user and agent memory (`skills/<name>/SKILL.md` under a memory level);
- MCP servers that some skills need; commands, sub-agents and hooks of Claude Code plugins;
- `/.well-known/agent-skills/` discovery (archives with a sha256, not git);
- skills inside a workspace (`.agents/skills` of the repository an agent works in).
