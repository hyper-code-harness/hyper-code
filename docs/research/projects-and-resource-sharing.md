# Projects and resource sharing for agents — product survey, research, recommendations for Hyper

Date: research run by a delegated agent. Product docs move fast; anything marked *(may be stale)* came from secondary sources or search snippets rather than the official docs page.

## TL;DR

1. **Use a tree (single `parent_id`) for *ownership and inheritance*, plus many-to-many *references* for sharing.** Products and the PIM literature agree: people navigate by folders (Bergman: strong preference for folders over tags, tags rarely used for retrieval), but sharing needs references, not copies (Letta shared blocks, MCP resource URIs, Linear agents as workspace members, Notion page inheritance with per-page override).
2. **Prompt carries an index, tools fetch contents.** This is how Claude Code (on-demand subdirectory CLAUDE.md, skills by description), Cursor ("Apply Intelligently" rules), Open WebUI native mode (agent browses knowledge via tools) and MCP (`resources/list` → `resources/read`) all work. Research on context engineering backs it: smaller curated context beats full history (Lodha et al.: 91.6% vs 71.0% task completion with ~2.7× fewer tokens).
3. **Visibility: own level + ancestors by default (inherited), subtree via an explicit tool call.** Ancestors give shared context (like CLAUDE.md going up the directory chain, Codex AGENTS.md root→cwd); descendants are noisy (news has 193 agents) — list them only on request, paged.
4. **An agent has exactly one home project** (ownership, settings, workspace_dir); it may be *referenced* from other projects as an `agent` resource. Same model as a file with symlinks.
5. **Concurrency: references point to live objects; writes go through the owner's normal APIs; for text-like shared state prefer append-only + one owner for rewrites** (Letta's documented rule). Add `version`/`updated_at` for optimistic checks.
6. **Treat every resource body as untrusted data**, never as instructions, unless it is an explicit instruction kind owned by the project (InjecAgent: GPT-4 ReAct agents compromised 24% of the time by indirect injection).

---

## 1. Product survey

| Product | Unit of grouping | Nesting | Resource types | In context vs via tools | Sharing / permissions | Inheritance |
|---|---|---|---|---|---|---|
| **ChatGPT Projects** | Project = chats + files + instructions | None (flat) | Files, instructions, project memory, chats | Instructions always in; files retrieved; "project-only memory" lets chats reference other chats *in the same project only* | Shared projects; shared projects *do not* get a member's personal memory/instructions | Project instructions override/extend global ones |
| **Claude.ai Projects** | Project = chats + knowledge + instructions | One level | Knowledge files, custom instructions | Knowledge in context (RAG when large) *(may be stale)* | Owner / can-edit / can-use roles; share by email | Chats do **not** share history; only instructions + files are shared |
| **Claude Code** | Working directory (sessions keyed by cwd) | Directory tree | CLAUDE.md, `.claude/rules/`, skills, subagents, settings, MCP | CLAUDE.md files *above* cwd load at launch; subdirectory files **load on demand**; `@path` imports; rules can be path-scoped | Subagents: own context window, own tools/permissions, inherit parent permission rules; built-in Explore/Plan start *without* CLAUDE.md | Managed policy → user → project → local; closer wins |
| **Cursor** | Workspace/repo | Nested AGENTS.md in subdirs | Rules (`.mdc`: Always / Apply Intelligently / glob / manual @), Team Rules, AGENTS.md, background agents | Rules either always-on, by glob, or chosen by the model from a description | Team Rules managed centrally and take precedence | User → project → team (team wins) |
| **Codex CLI / cloud** | Repo + cloud *environment* | AGENTS.md chain root→cwd | AGENTS.md, environment (image, setup, secrets) | AGENTS.md concatenated root→cwd, closer files later (override), capped at 32 KiB | Each task gets separate working state from a shared environment | Global `~/.codex` → project chain |
| **Zed** | Project/worktree; agent threads | — | Instructions (AGENTS.md), @-context, MCP | @-mentioned context; agent searches codebase via tools | Local | Personal + project instruction files |
| **Conductor** | Workspace = one git worktree per task | Repo → workspaces | Branch, chat, setup scripts | — | Isolation by worktree: "zero conflict between them" | Repo setup script inherited by every workspace |
| **Open WebUI** | Folders (with own knowledge/files), tags | Nested folders | Knowledge bases, files, models, prompts | Files attached in chat injected; with native function calling, the model *browses* knowledge (list/read/grep `kb_exec`) | Group-based access control; folder knowledge is measured against the **folder owner**; tools silently drop files the user cannot read | Chats started inside a folder get folder's knowledge |
| **LibreChat** | Agents, (projects for sharing) | — | Agents, files, prompts | file_search tool | Role permissions (`AGENTS.SHARED_GLOBAL`…); known bug: collaborators of a shared agent could not access its files (issue #8322) — a cautionary tale for reference sharing | — |
| **Notion AI** | Teamspace → pages | Deep page tree | Pages, databases, connected apps | AI searches workspace with user's permissions | Subpages take parent's permissions unless overridden | Permission inheritance down the tree |
| **Linear** | Workspace → teams → projects/issues | Shallow | Issues, docs | Agent receives issue context on delegation | **Agents are full workspace members**: assigned to issues, added to projects, scoped by team membership set by an admin | Team membership controls access |
| **GitHub Copilot (coding agent / Spaces)** | Repo; Spaces collect context | Path-specific `.instructions.md` | copilot-instructions.md, AGENTS.md, CLAUDE.md, `.instructions.md` with globs | Instructions injected; `@path` includes | Repo permissions | Repo-wide + path-specific |
| **Devin** | Org; sessions | — | Knowledge (auto-recalled by trigger), Playbooks, Machine snapshots | Knowledge retrieved when relevant | Org-wide knowledge; security profiles for snapshots | Org knowledge for all sessions |
| **OpenHands** | Repo | — | Skills/microagents (`.agents/skills`, legacy `.openhands/microagents/repo.md`) | `repo.md` always; keyword-triggered skills on demand | Repo | Global + repo skills |
| **Letta** | Agent; shared **memory blocks** | — | Core memory blocks, archival memory | Blocks are **in context** (pinned), archival via tools | One block attached to many agents by `block_id`; `read_only` blocks; changes visible immediately to all | — |
| **CrewAI** | Crew | Crew → agents | Memory, knowledge sources | Retrieved | All agents share crew memory unless one has its own | Crew-level default, agent override |
| **AutoGen** | Team / group chat | — | Memory protocol (RAG), shared transcript | Memory retrieves chunks into context | Group chat = shared transcript | — |
| **LangGraph** | Thread (short-term) + Store (long-term) | **Namespaces as tuples** e.g. `(user_id, "memories")` | Store items (JSON docs, searchable) | Fetched via store API/tools | Namespace = sharing boundary across threads | — |
| **MCP** | Server; client roots | URI hierarchy | Resources (URI, name, mimeType, annotations `audience`, `priority`), resource templates, `resource_link` in tool results | Listing via `resources/list`, contents via `resources/read`; app decides what to inject; `subscribe` + `listChanged` notifications | Roots tell servers the boundaries ("informational, not strictly enforced") | — |
| **Google A2A** | Agent (Agent Card at `/.well-known/agent-card.json`) | — | Tasks, Messages (Parts: text/file/data), Artifacts | Exchanged per task | Agents are opaque; share only artifacts/messages, not internal memory | — |

### Patterns across products
- **Two levels dominate in consumer chat** (ChatGPT, Claude.ai: flat). **Deep trees appear where there is a filesystem or document tree** (Claude Code, Codex, Cursor nested AGENTS.md, Notion, Open WebUI nested folders).
- **Instructions inherit down the tree, closest wins** (Claude Code, Codex, Cursor, Copilot, Notion permissions). Organization-level policy may override everything (Cursor Team Rules, Claude Code managed policy).
- **Index in prompt, body by tool** is the convergent design for anything bigger than a page: Claude Code skills/subdirectory memory, Cursor "Apply Intelligently", Devin knowledge triggers, OpenHands keyword skills, Open WebUI native mode, MCP list/read.
- **Sharing is by reference with ACL checked at read time** (Letta block_id, Open WebUI per-file filtering, Linear team membership). LibreChat shows what goes wrong when the reference is shared but the ACL of the referenced object is not — the shared agent was visible, its files were not.
- **Isolation for concurrent writers is physical** in coding tools (Conductor / Claude Code worktrees, Codex per-task working state) rather than locking.
- **Separate chats in a project do not see each other's transcripts** by default (Claude.ai) or only within the project (ChatGPT project memory). Transcripts are not a shared resource; summaries/artifacts are.

Sources (products):
- https://help.openai.com/en/articles/10169521-projects-in-chatgpt · https://openai.com/academy/projects/ · https://help.openai.com/en/articles/8590148-memory-faq
- https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects · https://www.anthropic.com/news/projects · https://academy.claude.com/courses/claude-101/introduction-to-projects · https://www.ai-toolbox.co/claude-management-and-productivity/how-to-use-claude-projects-guide-2026 *(secondary)*
- https://code.claude.com/docs/en/memory · https://code.claude.com/docs/en/sub-agents · https://code.claude.com/docs/en/worktrees
- https://cursor.com/docs/rules
- https://developers.openai.com/codex/guides/agents-md · https://developers.openai.com/codex/cloud · https://developers.openai.com/codex/cloud/environments
- https://zed.dev/docs/ai/agent-panel · https://zed.dev/docs/ai/agent-settings
- https://www.conductor.build/docs/guides/git-worktrees/run-claude-code-with-git-worktrees · https://julianastrada.com/blog/conductor-parallel-agents/ *(secondary)*
- https://docs.openwebui.com/features/workspace/knowledge/ · https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/
- https://github.com/danny-avila/LibreChat/issues/8322 · https://github.com/danny-avila/LibreChat/discussions/9814
- https://www.notion.com/help/sharing-and-permissions
- https://linear.app/docs/agents-in-linear · https://linear.app/agents
- https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot · https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions/ · https://code.visualstudio.com/docs/agent-customization/custom-instructions
- https://cognition.com/blog/june-24-product-update · https://docs.devin.ai/release-notes/overview
- https://docs.openhands.dev/overview/skills · https://github.com/OpenHands/OpenHands/blob/main/skills/README.md
- https://docs.letta.com/guides/agents/multi-agent-shared-memory
- https://docs.crewai.com/en/concepts/memory
- https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/memory.html
- https://docs.langchain.com/oss/python/langgraph/stores
- https://modelcontextprotocol.io/specification/2025-06-18/server/resources · https://modelcontextprotocol.io/specification/2025-06-18/client/roots
- https://a2a-protocol.org/latest/specification/ · https://github.com/a2aproject/A2A/blob/main/docs/specification.md

## 2. Academic evidence

### Folders vs tags (personal information management)
- **Bergman, Gradovitch et al. 2013, JASIST** — "Folder versus tag preference in PIM". Two studies (incl. 7-week longitudinal): strong preference for folders for storage *and* retrieval; when tags were used, usually one tag per item; multiple classification was only marginally used for retrieval; controlled task showed **lower success and slower retrieval with tags**. https://doi.org/10.1002/asi.22906
- **Bergman & Whittaker 2010, JASIST** — "The effect of folder structure on personal file navigation": users with shallow structures and small folders reached **94% of files**; time and success depend on folder size and depth. https://doi.org/10.1002/asi.21415
- **Civan & Jones 2008** — folders vs labels: both have strengths; combining helps. https://doi.org/10.1002/meet.2008.1450450214
- **Bergman & Whittaker 2016, MIT Press** — *The Science of Managing Our Digital Stuff* (navigation beats search for personal items). https://doi.org/10.7551/mitpress/9780262035170.001.0001
- Dinneen & Julien 2019 review of file management research. https://doi.org/10.1002/asi.24222

→ Supports **single-parent tree as the primary organisation**, keep it **shallow**, and keep secondary multi-membership as a lightweight add-on, not the main mechanism.

### Hierarchical / structured memory and context for LLM agents
- **MemGPT (Packer et al. 2023)** — OS-style tiers: small in-context "main memory" + external storage paged in by function calls. https://doi.org/10.48550/arxiv.2310.08560 → index-in-prompt, body-via-tool.
- **H-MEM (Sun et al. 2025)** — multi-level memory by abstraction with index-based routing layer by layer; beats 5 baselines on LoCoMo. https://doi.org/10.48550/arxiv.2507.22925
- **HiAgent (Hu et al. 2024)** — hierarchical working memory by subgoals; reported ~2× success rate and 3.8 fewer steps on long-horizon tasks. https://doi.org/10.48550/arxiv.2408.09559
- **G-Memory (Zhang et al. 2025)** — three-tier hierarchical memory for *multi-agent* systems; up to **+20.89%** success (embodied) and **+10.12%** accuracy (QA) without changing frameworks. https://doi.org/10.48550/arxiv.2506.07398
- **A-MEM (Xu et al. 2025)** — Zettelkasten-style linked notes that the agent itself organizes; beats SOTA on six models. https://doi.org/10.48550/arxiv.2502.12110 → links (references) between items are as important as the hierarchy.
- **Git Context Controller (Wu et al. 2025)** — context as a versioned file system (COMMIT/BRANCH/MERGE/CONTEXT); **+13% relative** on SWE-Bench Verified, >80% resolved. https://doi.org/10.48550/arxiv.2508.00031 → versioning + hierarchical retrieval is a good fit for shared, mutable resources.
- **"Less Context, Better Agents" (Lodha et al. 2026)** — full history 71.0% completion with 1.48M tokens; pruning 79.0% / 535k tokens; pruning + summary **91.6%** / 553k tokens. https://doi.org/10.48550/arxiv.2606.10209
- **An et al. 2024, "Make Your LLM Fully Utilize the Context"** — lost-in-the-middle persists in long contexts. https://doi.org/10.48550/arxiv.2404.16811
- Survey: Zhang et al., *A Survey on the Memory Mechanism of LLM-based Agents*, ACM TOIS. https://doi.org/10.1145/3748302

→ Confirms: **put a compact list/index in the prompt and fetch details on demand**; do not dump subtree contents.

### Shared workspace / blackboard architectures
- **Han et al. 2025** — blackboard-based LLM MAS: competitive with SOTA static/dynamic MAS with **fewer tokens**. https://doi.org/10.48550/arxiv.2507.01701
- **Salemi et al. 2025** — blackboard for data discovery: **13–57% relative** end-to-end improvement, up to 9% F1. https://doi.org/10.48550/arxiv.2510.01285
- **Terrarium (Nakamura et al. 2025)** — blackboard as a lens on MAS safety/privacy: shared boards are the main attack surface. https://doi.org/10.48550/arxiv.2510.14312
- PatchBoard 2026 — schema-grounded, auditable state mutation for shared boards. https://doi.org/10.48550/arxiv.2605.29313

→ A project with shared resources *is* a blackboard; the benefits are real but writes need schemas/audit.

### Access control and sharing between agents
- **Collaborative Memory (Rezazadeh et al. 2025)** — private + shared memory tiers, every fragment carries immutable provenance (agent, resources accessed, time); read policies project filtered views, write policies decide retention/sharing; asymmetric, time-varying permissions. https://doi.org/10.48550/arxiv.2505.18279
- GateMem 2026 (benchmark for memory governance with multiple principals). https://doi.org/10.48550/arxiv.2606.18829
- CapChain 2026 — capability tokens with verifiable provenance for multi-agent access. https://doi.org/10.3390/app16157776
- **Miller et al. / Object capabilities (2006)** — authority = holding an unforgeable reference; enables least privilege and attenuation. https://doi.org/10.1145/1134744.1134745

→ Two workable models: ACL checked at read time (simple, matches Open WebUI/Notion) or capability-style references (`ref` in a project grants access). For a single-user system, **"membership in a project grants read; write follows the owner"** is enough; record provenance.

### Prompt injection via shared content
- **Greshake et al. 2023** — indirect prompt injection compromises LLM-integrated apps (data theft, worming). https://doi.org/10.1145/3605764.3623985
- **InjecAgent (Zhan et al. 2024)** — 30 agents; ReAct GPT-4 vulnerable **24%** of the time, ~2× with enhanced attacks. https://doi.org/10.48550/arxiv.2403.02691
- **BIPIA (Yi et al. 2023/2025)** — boundary awareness + explicit reminders mitigate (black-box), near-zero ASR in white-box. https://doi.org/10.1145/3690624.3709179

→ Resource titles/descriptions shown in the prompt are an injection vector; wrap them as data, keep instructions as a separate trusted kind.

### Polymorphic references
No strong academic literature found specifically; the industry precedents are **MCP resource URIs + templates**, **Rails polymorphic associations** (`*_type`, `*_id`) and URI schemes. Known downsides: no FK integrity (dangling refs) → needs resolver + garbage check per kind.

## 3. Synthesis for Hyper

### What the evidence confirms in the draft
- `projects(parent_id)` tree — matches folder preference (Bergman) and every tool with filesystem semantics; settings inherited down matches Claude Code / Codex / Cursor / Notion.
- `project_resources(project_id, kind, ref, title, meta)` polymorphic, kinds declared by plugin files `$resource_<kind>.ts {label, icon, href, canvas, search, describe}` — maps 1:1 onto MCP Resources (`uri`, `name`, `mimeType`, `resources/list`, `resources/read`, templates for search) and fits Hyper's one-file-per-thing convention.
- "Agent sees the list, not contents" + tools `project.resources/describe/add/remove` — the convergent index-then-fetch pattern (MemGPT, MCP, Claude Code skills, Open WebUI native mode, Lodha et al.).
- Agent as a resource kind — Linear (agents are workspace members) and A2A (agent card as a reference) do exactly this.

### What it contradicts / needs adding
- **Pure single-parent for agents is too strict** if a resource must appear in two places; products solve this with references (Letta block attached to many agents). Since resources are already references, multi-placement comes free — *keep the ownership single, allow reference rows anywhere*.
- **Missing ownership/ACL on the referenced object** — LibreChat's bug shows that sharing a reference without carrying access is the common failure.
- **Missing staleness/versioning** — MCP has `listChanged`/`subscribe`; GCC/Letta show version/conflict concerns.
- **Missing trust level of a resource** — needed for injection defence.

### Recommended decisions

**(1) Visibility of the subtree.** Default prompt view = resources of *own project + all ancestors* (inherited, labelled by level, nearest first, capped e.g. 30 items with "+N more"), mirroring CLAUDE.md/AGENTS.md walking up the tree. *Descendants are not listed*; show only counts per child project ("news/rss: 41 resources, 12 agents"). Full subtree via `project.resources({ scope: "subtree", kind?, q?, limit })`. Rationale: ancestors are shared context; descendants are where noise lives (news: 193 agents). Allow a per-resource flag `pinned` (always in prompt, like Cursor Always Apply) and `inherit: false` (do not propagate to children).

**(2) Sharing between agents/projects.** *References, not copies.* A row in `project_resources` is a pointer `(kind, ref)`; the same `(kind, ref)` may appear in several projects. Each kind's resolver (`describe`) is the single source of truth and checks access at read time. Ownership stays with the underlying object (agent row, file, note), not with the reference. Add `added_by` (agent/user) and `created_at` for provenance (Collaborative Memory). Copies only on explicit `fork/snapshot` (like Devin machine snapshots, git branch). For a single-user Hyper, permission = "any agent in a project (or its descendants) can read resources visible to it; writes go through the kind's own API with its own checks"; add `read_only` per reference later if needed (Letta).

**(3) Can agents belong to multiple projects?** *One home project* (`agents.project_id`, nullable → derived from `workspace_dir` initially) that defines inherited settings and where the agent appears in navigation. *Additional appearances* are `project_resources(kind='agent', ref=agent_id)` references — they show the agent in that project's list and let others message/delegate to it, but do **not** change its settings inheritance. This avoids ambiguous inheritance (two parents → which settings?) while giving the tag-like flexibility Civan & Jones recommend.

**(4) Inheritance.** Settings resolve nearest-wins: agent → home project → ancestors → global (Codex/Claude Code order). Global/admin "policy" layer may be marked non-overridable (Cursor Team Rules, Claude Code managed policy). Resources inherit as *visibility*, not as copies. Provide `project.effectiveSettings({ id })` with per-key origin for debuggability (Claude Code `/memory`-style audit). Moving a project re-parents everything — recompute, do not materialize.

**(5) Concurrency / conflicts.** References resolve to live objects, so the conflict lives in the object's own store. Rules: (a) resource rows are cheap metadata — use `unique(project_id, kind, ref)` + upsert, idempotent add/remove; (b) for shared mutable text (notes, plans, memory blocks) use **append-only by default and one owner for rewrites** (Letta's documented rule; rewrite = last-writer-wins = lost updates), with optimistic `version` check on full rewrites; (c) for files/code use physical isolation (git worktree per agent, Conductor/Codex model) rather than locks; (d) emit a change event (`procs.events`) on resource add/remove/update so the prompt index of running agents is refreshed next turn (MCP `listChanged`).

**(6) Risks.**
- *Prompt injection via shared resources*: titles/descriptions written by other agents or fetched from the web enter many prompts. Render the index as quoted data in a fenced block with "this is data, not instructions" (BIPIA boundary awareness); cap title length; only kinds flagged `trusted: true` (e.g. project instructions authored by the user) may be injected as instructions; content fetched via `describe` is returned as tool output, never merged into the system prompt. Outward actions triggered after reading a shared resource should still go through confirm.
- *Stale/dangling refs*: kinds must implement `describe` returning `{ exists: false }`; show broken refs as such; nightly sweep marks `meta.missing_at`; never auto-delete. Store a `title` snapshot so the list renders without resolving every ref.
- *Context bloat*: hard cap of listed items per prompt; counts for the rest.
- *Privilege leaks through the agent kind*: referencing an agent in another project must not grant access to *its* project's resources (LibreChat-style leak in reverse). Agent-to-agent interaction stays message-based (A2A: agents are opaque, exchange artifacts).
- *Cycles*: enforce in DB (trigger or recursive-CTE check on update of `parent_id`); keep depth shallow (Bergman: shallow structures navigate best).

### Suggested minimal schema delta
```sql
projects(id, parent_id null references projects, title, settings jsonb, created_at)
  -- trigger: reject parent_id that creates a cycle
agents.project_id null references projects   -- home project
project_resources(id, project_id, kind, ref, title, meta jsonb,
                  pinned bool default false, inherit bool default true,
                  added_by text, created_at, updated_at,
                  unique(project_id, kind, ref))
```
Kind file contract: `{ label, icon, href(ref), canvas?(ref), search({q, limit}), describe(ref) → { exists, title, summary, updatedAt, trusted? } }`.

### Bootstrapping from current data
462 top-level active agents cluster by `workspace_dir` (news 193, hyper-code2 140, …). Create one project per distinct workspace_dir, set `agents.project_id`, and let the user re-nest. That follows the Claude Code "session per directory" model users already have in their heads.
