# Pluggable orchestration: prior art and a `process` plugin for Hyper

Status: research note. Date: 2026. Sources are web, arXiv and Consensus searches.
Numbers marked ≈ come from the papers' abstracts or well-known reported results. They were not reproduced here.

## 1. TL;DR

- Nobody ships "swap agile ↔ waterfall ↔ swarm with one config line" as a **general** runtime for human+agent teams. Swapping exists in three narrow forms:
  1. **topology enum** in frameworks: CrewAI `Process.sequential|hierarchical`, AutoGen `RoundRobin|Selector|Swarm|MagenticOne` teams, LangGraph `create_supervisor` / `create_swarm`;
  2. **hard-coded SOP per system** in research: MetaGPT (waterfall), ChatDev (phase chain), AgileCoder (sprints). Here a new methodology means a new codebase;
  3. **declarative workflow engines** without LLM semantics: Jira/Linear workflow schemes, BPMN (Camunda), statecharts (XState), Temporal. They declare states, transitions, guards and post-functions well, but they know nothing about agents, prompts or review.
- The closest match to our idea is **Jira workflow scheme + roles + Camunda's "agentic BPMN" + Spec Kit/BMAD's per-phase role prompts**. Our plugin puts these together: states/transitions/guards (Jira), roles with prompts (MetaGPT/BMAD), reactions to events (post-functions/hooks), and cron cadence (sprints).
- The evidence says **process changes cost/quality trade-offs and does not make results uniformly better**. A study with 132 runs: Waterfall was cheapest, Agile gave the best quality at higher cost, and V-Model produced the most verbose code. On ClassEval, waterfall cut functional correctness by ≈38–40% for two of three models. MAST (1600+ traces, 7 frameworks) finds that most failures come from spec/role design and missing verification, not from the model. So the declaration has to make **verification and stop conditions** explicit, not just roles.

## 2. Survey (21 systems)

| # | System | What is declared | What stays code | How you swap | Results / notes | URL |
|---|---|---|---|---|---|---|
| 1 | **MetaGPT** | Roles (PM, Architect, PM-tasks, Engineer, QA) with profile/goal/actions. Each role *watches* message types and publishes to a shared message pool. The SOP is encoded as structured artifacts (PRD, design, API spec) | Role and Action classes in Python. The SOP order comes from subscriptions | Write other Role classes or another subscription graph. No process config | ≈HumanEval 85.9%, MBPP 87.7% Pass@1 (ICLR'24). Structured artifacts cut hallucination cascades | arxiv.org/abs/2308.00352 |
| 2 | **ChatDev** | A *chat chain*: phases (design → coding → testing → documenting), each a dialogue between two roles (instructor/assistant). Phase config lives in JSON (`ChatChainConfig.json`, `PhaseConfig.json`, `RoleConfig.json`) | Phase classes | **Edit the JSON config**: order of phases, loop phases (`ComposedPhase` with `cycleNum`), role prompts. This is the closest thing to a declarative methodology among research systems | Better executability/consistency than GPT-Engineer. Later "Experiential Co-Learning" and MacNet variants | arxiv.org/abs/2307.07924, github.com/OpenBMB/ChatDev |
| 3 | **AgileCoder** | Sprints: Product Manager makes a backlog, Scrum Master plans the sprint, developer/tester/senior dev implement and review, then a sprint review. Plus a dynamic code dependency graph | All of it in Python | No swapping, agile is fixed | Reports beating ChatDev and MetaGPT on HumanEval/MBPP and on its own ProjectDev (exact figures not checked here, see the paper's tables) | arxiv.org/abs/2406.11912 |
| 4 | **Process-model studies** (2025) | Waterfall, V-Model and Agile as coordination scaffolds over the same agents | — | Same agents, different scaffold. This is exactly our experiment | 11 projects × 3 processes × 4 GPT models = 132 runs: **Waterfall most efficient, Agile highest quality at higher cost**. ClassEval waterfall study: cleaner code but correctness −37.8% (GPT‑4o‑mini) and −39.8% (DeepSeek). FlowGen/SOEN‑101 emulates Waterfall/TDD/Scrum. Scrum-style was reported as the strongest variant there (figures not checked here) | doi 10.48550/arxiv.2509.13942, 10.48550/arxiv.2511.09794, SOEN-101 (ICSE'25) |
| 5 | **CrewAI** | `Agent(role, goal, backstory)`, `Task(description, expected_output, agent, context)`, `Crew(process=Process.sequential\|hierarchical, manager_llm)`. YAML configs for agents and tasks. **Flows**: `@start`, `@listen`, `@router`, with state | Tools, Flow methods | Change the `process` enum. Hierarchical adds a synthesized manager that delegates. Flows cover custom event routing | Docs warn that weak manager LLMs give vague delegation. No benchmark | docs.crewai.com |
| 6 | **AutoGen / AgentChat** | Team presets: `RoundRobinGroupChat`, `SelectorGroupChat` (LLM or `selector_func` picks the next speaker, `candidate_func` narrows the choice), `Swarm` (handoffs via `HandoffMessage`), `MagenticOneGroupChat`, `GraphFlow` (DiGraph with conditional edges). Termination conditions can be combined (`MaxMessage \| TextMention \| Handoff`) | Agents, tools, selector functions | Swap the team class over the same agents. **Termination conditions are first-class**, and we should copy that | Magentic-One results below | microsoft.github.io/autogen |
| 7 | **Magentic-One** | Orchestrator with a **Task Ledger** (facts, guesses, plan) and a **Progress Ledger** (is it done? are we looping? who is next? what instruction?). Outer loop re-plans when progress stalls | Ledger prompts, agents (WebSurfer, FileSurfer, Coder, Terminal) | Fixed orchestrator. Agents are pluggable | ≈GAIA 38%, AssistantBench 27.7%, WebArena 32.8% (competitive with SOTA in 2024). Stall counter → replan is the key anti-loop device | arxiv.org/abs/2411.04468 |
| 8 | **OpenAI Swarm → Agents SDK** | Agent = instructions + tools + `handoffs=[...]`. A handoff is a tool call that transfers control. Guardrails (input/output tripwires), `Agent.as_tool()` for manager style | Everything in Python | Two patterns: handoffs (decentralized) or agents-as-tools (manager). Swap by rewiring | No benchmark. The handoff graph is static code | openai.github.io/openai-agents-python |
| 9 | **LangGraph** | StateGraph: nodes, edges, conditional edges, `Command(goto=…)`, checkpoints, `interrupt()` for a human in the loop. Prebuilt `langgraph-supervisor` and `langgraph-swarm` | Nodes | Swap the prebuilt graph builder. The same agents fit both supervisor and swarm | LangChain benchmark (τ-bench-like): swarm slightly better than supervisor, because the supervisor "translates" and loses information | reference.langchain.com/python/langgraph-supervisor |
| 10 | **Semantic Kernel Process Framework** | `ProcessBuilder`: steps (KernelFunctions), events, `OnEvent(...).SendEventTo(step)`, state per step. Runs on local runtime, Dapr or Orleans | Steps | Declarative event wiring. Swap the wiring | Enterprise focus, no LLM benchmark | learn.microsoft.com/semantic-kernel/frameworks/process |
| 11 | **GitHub Spec Kit** | Phases as slash-commands: `/constitution` → `/specify` → `/clarify` → `/plan` → `/tasks` → `/analyze` → `/implement`. Artifacts are markdown (`spec.md`, `plan.md`, `tasks.md`) with templates. Constitution = project-wide guards | The agent itself (Claude/Copilot/Gemini…) | Methodology = templates + prompts + artifact gates. Agent-agnostic | No benchmark. Key idea: **the artifact is the gate** (no plan without spec) | github.com/github/spec-kit |
| 12 | **Kiro** | Spec = `requirements.md` (EARS notation) → `design.md` → `tasks.md`. **Hooks**: event (file save/create) → agent prompt. Steering files hold the rules | IDE agent | Spec mode vs vibe mode | Hooks = our "reactions" | kiro.dev |
| 13 | **BMAD Method** | Agent personas as markdown/YAML (Analyst, PM, Architect, Scrum Master, Dev, QA). Workflows produce PRD → architecture → sharded **story files** with full context. "Expansion packs" ship other domains | The host LLM IDE | **Swap the expansion pack / workflow YAML**. This is the closest real "methodology as a plugin file" | Community, no benchmark | github.com/bmad-code-org/BMAD-METHOD |
| 14 | **Claude Code** | Subagents as `.claude/agents/*.md` (frontmatter: name, description, tools, model + prompt). **Hooks** (PreToolUse, PostToolUse, Stop, SubagentStop, UserPromptSubmit) run shell and can block. Slash commands, skills | Hook scripts | Swap the agent/hook/command files. A Stop hook can enforce "not done until tests pass" | Hooks are the only *enforced* guard. Prompts alone get ignored | docs.anthropic.com/claude-code |
| 15 | **CAMEL** | Role-playing: AI user + AI assistant + task specifier, with inception prompts | Prompts | Swap the role pair / prompts | Found role flipping, infinite loops of "thanks" and instruction repetition, the earliest documentation of these failures | arxiv.org/abs/2303.17760 |
| 16 | **AgentVerse** | Stages: expert recruitment → collaborative decision making (horizontal/vertical) → action execution → evaluation, looping back | Python | Choose the decision structure (horizontal = democratic, vertical = solver + reviewers) | Groups beat a single agent on several tasks. Documents both useful and harmful emergent social behaviours | arxiv.org/abs/2308.10848 |
| 17 | **Google A2A** | Task lifecycle states: `submitted, working, input-required, auth-required, completed, failed, canceled, rejected`. Agent Card (skills), artifacts, messages | Agent internals | Not a methodology, it is the **inter-agent task contract** | Good reference set of states for "item waiting for human" | a2a-protocol.org, agent2agent.info/docs/concepts/task |
| 18 | **Agent Protocol** (AI Engineer Foundation) | REST: tasks and steps (`POST /ap/v1/agent/tasks`, `/steps`), artifacts | Agent | — | Minimal task/step/artifact contract | agentprotocol.ai |
| 19 | **Jira / Linear workflows** | Jira: statuses, transitions, **conditions** (who may), **validators** (required fields), **post-functions** (side effects), screens. Workflow *schemes* map issue types to workflows per project. Linear: fixed categories (backlog/unstarted/started/completed/canceled) with custom states per team, cycles = cadence | Plugins/Forge apps | **Assign a workflow scheme to a project**. This is exactly the "project chooses a process" pattern, proven at scale | Decades of practice. Pitfall: over-configured workflows that nobody follows | support.atlassian.com/jira-cloud-administration |
| 20 | **BPMN / Camunda, Temporal** | BPMN: tasks, gateways, events, timers, user tasks, swimlanes (= roles). Camunda 8.8 "agentic orchestration": an AI agent connector inside an ad-hoc subprocess picks tools. Temporal: workflows in code, durable, deterministic replay, signals, timers | Temporal: everything is code. Camunda: service workers | Deploy a different BPMN model | Lesson: **deterministic skeleton + bounded agentic islands** (ad-hoc subprocess) | docs.camunda.io/…/agentic-orchestration, temporal.io |
| 21 | **Statecharts / Petri nets** | XState: hierarchical/parallel states, guards, actions, invoked actors. `@statelyai/agent` lets an LLM choose events allowed in the current state. Petri nets: TB-CSPN (Borghoff et al.) puts humans, LLM consultants and workers on coloured Petri nets with topic tokens | Actions | Swap the machine definition | Formal analysis (reachability, deadlock-freedom) is possible. The LLM is restricted to *legal* events | github.com/statelyai/agent, mdpi.com/1999-5903/17/8/363 |

Also relevant: **AFlow** (MCTS search over workflow code, +5.7% avg over baselines, small models beat GPT‑4o at 4.55% of the cost, arxiv 2410.10762), **MASS** (topology + prompt search, ≈84% vs 76–80% on MATH, 2502.02533), **Self-Organized Agents** (agents multiply with problem size, +5% Pass@1, 2404.02183). Their lesson: the *best* topology depends on the task, and prompts matter at least as much as topology. That supports "process as data, chosen per project".

## 3. What the prior art confirms and contradicts in our idea

**Confirms**
- *Process as data attached to a project*: Jira workflow schemes, ChatDev JSON configs, BMAD expansion packs and Spec Kit templates all show that swapping a declared methodology works without touching the engine.
- *Typed items + states + guarded transitions*: Jira (conditions/validators/post-functions), A2A task states, our `team.reduceTask` (versioned strict transitions, review authority).
- *Roles with per-role prompts*: MetaGPT, ChatDev, BMAD, CrewAI, Claude Code subagents.
- *Artifacts as gates*: MetaGPT structured documents, Spec Kit/Kiro files. A transition guard like "requires artifact `spec`" is the main tool against drift.
- *Reactions to events*: Kiro hooks, Claude Code hooks, Jira post-functions, SK `OnEvent`, CrewAI `@listen`.
- *Cadence*: Linear cycles, AgileCoder sprints. In our case, cron triggers.
- *The LLM chooses only among legal moves*: `@statelyai/agent`, Selector `candidate_func`, our strict reducer.

**Contradicts / warns**
- **Process is not a free win.** It changes the cost/quality profile, and waterfall can *lower* correctness. The plugin has to make A/B comparison cheap (same items, different process) and record cost.
- **Manager/supervisor topologies lose information.** LangGraph found swarm ≥ supervisor. CrewAI warns about weak managers. Hierarchical should hand off *items with artifacts*, not paraphrased chat.
- **Full declarative workflow languages (BPMN) are heavy.** Our own `workflow-engine-design.md` deliberately refuses its own DSL. The `$process_` file must stay a small TS object plus guard *functions*, not a language.
- **Agents ignore prompt-only rules** (MAST: "disobey task/role specification", "premature termination", "no or incomplete verification"). Only guards that the engine enforces (Claude Code hooks, the reducer) are reliable.

## 4. Minimal primitives covering agile, waterfall, spec-driven, swarm, hierarchical

1. **ItemType**: name, fields/required artifacts, state machine (`states`, `initial`, `terminal`).
2. **Transition**: `from → to`, `by` (role list or `assignee|reviewer|owner`), `guard` (runtime-fn name + args: artifact present, tests green, children all done, WIP limit), `effects` (set field, create child items, notify). It reuses the `reduceTask` semantics: version check, single actor, evidence.
3. **Role**: name, `prompt`, who can fill it (agent model / human), capacity (WIP), `claims` (which item types/states it may pull).
4. **Claim with lease**: `claim(item)` → lease until T, heartbeat, expiry → back to pool. This covers swarm (pull) and avoids double work.
5. **Reaction**: `on: event` (item entered state X, item created, lease expired, cron tick, external watch) → `do:` wake role / create items / post to board / transition. Bounded by budget.
6. **Hierarchy**: `parent` on items and the guard `children.allIn(['done'])`. This gives epics/stories, waterfall phases and supervisor decomposition.
7. **Cadence**: cron → reaction (sprint planning, standup digest, retro).
8. **Budget & stop**: per item and per project: max transitions, max tokens/$, max reopen count, deadline. A violation → `blocked` + human.

Mapping:
- **Waterfall** = one phase item type per stage + children guard + artifact guards.
- **Spec-driven** = waterfall per feature with artifact gates (`spec→plan→tasks→impl`) + human approval on `spec`.
- **Agile** = backlog + cadence (sprint) + WIP limit + review transitions.
- **Swarm** = no assignment; roles claim by type/state with lease, plus reactions.
- **Hierarchical** = the lead role decomposes (creates children), workers claim, and the lead reviews.

None of these needs a new engine primitive. They differ only in the declaration.

## 5. Pitfalls and mitigations

| Pitfall | Seen in | Mitigation in `process` |
|---|---|---|
| Infinite review ping-pong / chat loops | CAMEL, ChatDev, MAST "step repetition" | `maxReopen` per item, Magentic-style stall counter → escalate to human |
| Cost blow-up | Agile in the 132-run study, hierarchical managers | Budget per item/project. Reactions are rate-limited. Cadence instead of eager wakes |
| Deadlock: everyone waits (review needs a reviewer who is busy, children are blocked) | Petri-net literature, Jira | Static check at load time: every non-terminal state has an exit transition reachable by some role that exists in the project. Lease expiry. `blocked` always → human |
| Lost wakeups / double execution | our `workflow-engine-review.md` (wake during run, `checking` not recovered) | Fix those defects first. Claims by atomic UPDATE…RETURNING. Version on every transition |
| Agents ignore the process (say "done" without the artifact) | MAST, Claude Code experience | Transitions only through `process.transition`, guards are functions, the role prompt is generated from the *allowed* transitions of the current state |
| Information loss through the manager | LangGraph supervisor | Items carry artifacts/links. Workers read the item, not the manager's paraphrase |
| Over-specified process nobody follows | Jira | Keep declarations under about 60 lines. Start with 4 shipped processes |
| Hot-reload changes the process under live items | design doc §6 | Freeze the `processVersion` on the project. Migrate explicitly |

## 6. Recommended shape of `$process_<name>.ts`

```ts
// plugins/process/src/process/$process_<name>.ts
export default {
  name: 'agile', version: 1,
  roles: { po: {prompt:'…', human:true}, dev: {prompt:'…', wip:1}, reviewer: {prompt:'…'} },
  items: {
    story: {
      states: ['backlog','ready','doing','review','done','dropped'], initial: 'backlog', terminal: ['done','dropped'],
      transitions: [
        { from:'backlog', to:'ready',  by:['po'] },
        { from:'ready',   to:'doing',  by:['dev'], claim:true },                    // lease
        { from:'doing',   to:'review', by:['assignee'], guard:{ fn:'process.hasArtifact', args:{kind:'diff'} } },
        { from:'review',  to:'done',   by:['reviewer'], notSame:'assignee' },
        { from:'review',  to:'doing',  by:['reviewer'], countAs:'reopen' },
      ],
    },
  },
  reactions: [
    { on:{ entered:'story.review' }, do:{ wake:'reviewer' } },
    { on:{ cron:'0 9 * * 1' },       do:{ wake:'po', prompt:'Sprint planning: move ≤N stories to ready' } },
  ],
  limits: { maxReopen: 3, itemBudgetUsd: 2, stallMs: 4*3600e3 },
} satisfies types.process.Definition;
```

Guards are names of runtime functions (read-only, as in the readiness contract of the workflow design), never inline code that the engine must trust. `by` accepts roles or the relational keywords `assignee | reviewer | owner | parent.assignee`.

### Waterfall
```ts
roles: { analyst:{…}, architect:{…}, dev:{…}, qa:{…}, owner:{human:true} },
items: { phase: { states:['pending','active','signoff','done'],
  transitions:[
   {from:'pending', to:'active', by:['system'], guard:{fn:'process.prevPhaseDone'}},
   {from:'active',  to:'signoff', by:['assignee'], guard:{fn:'process.hasArtifact', args:{kind:'phaseDoc'}}},
   {from:'signoff', to:'done',   by:['owner']} ] } },
seed: [ {type:'phase',title:'Requirements',role:'analyst'}, {…'Design','architect'}, {…'Build','dev'}, {…'Test','qa'} ],
reactions: [{ on:{entered:'phase.done'}, do:{ transition:{ next:'phase', to:'active' } } }],
```

### Spec-driven (Spec Kit / Kiro)
```ts
items: {
  feature: { states:['spec','plan','tasks','build','done'], transitions:[
    {from:'spec',  to:'plan',  by:['owner'],     guard:{fn:'process.hasArtifact',args:{kind:'spec.md'}}},   // human approves spec
    {from:'plan',  to:'tasks', by:['architect'], guard:{fn:'process.hasArtifact',args:{kind:'plan.md'}}},
    {from:'tasks', to:'build', by:['architect'], effect:{ createChildren:'task', from:'tasks.md' }},
    {from:'build', to:'done',  by:['system'],    guard:{fn:'process.childrenIn',args:{states:['done']}}} ]},
  task: { /* todo→doing(claim)→review→done, as in agile */ },
},
roles: { owner:{human:true}, architect:{prompt:'Write plan.md honoring constitution.md'}, dev:{…}, reviewer:{…} },
```

### Swarm
```ts
roles: { worker:{ prompt:'Pick any open item you can do; split it if too big', wip:1, count:5 } },
items: { job: { states:['open','claimed','done','failed'], transitions:[
  {from:'open',    to:'claimed', by:['worker'], claim:{ leaseMs: 15*60e3 }},
  {from:'claimed', to:'open',    by:['system'], on:'leaseExpired'},
  {from:'claimed', to:'done',    by:['assignee'], guard:{fn:'process.verify'}, effect:{ allowCreate:'job' }},
  {from:'claimed', to:'failed',  by:['assignee']} ]}},
reactions: [{ on:{ created:'job' }, do:{ wake:{ role:'worker', idleOnly:true } } }],
limits: { maxItems: 200, projectBudgetUsd: 20 },
```

### Hierarchical (supervisor)
```ts
roles: { lead:{ prompt:'Decompose goal into subtasks with acceptance criteria; review results' }, worker:{…} },
items: {
  goal: { states:['open','decomposed','integrating','done'], transitions:[
    {from:'open', to:'decomposed', by:['lead'], effect:{ allowCreate:'subtask' }},
    {from:'decomposed', to:'integrating', by:['system'], guard:{fn:'process.childrenIn',args:{states:['done','cancelled']}}},
    {from:'integrating', to:'done', by:['lead'], guard:{fn:'process.hasArtifact',args:{kind:'result'}}} ]},
  subtask: { /* = team.reduceTask: todo→assigned(by lead)→working→review(by lead)→done */ },
},
reactions: [{ on:{ entered:'goal.integrating' }, do:{ wake:'lead' } }],
```

## 7. Recommendations for Hyper

1. **Generalize `team.reduceTask`** into `process.reduce(definition, item, command)`. Keep its strictness (version check, single actor, evidence, review authority). The current team board becomes `$process_hierarchical`.
2. **Validate the definition when it loads**: reachability, no dead non-terminal states, every `by` role exists, guards resolve to existing read-only runtime functions. This is a cheap Petri-net-style check.
3. **Generate role prompts** from the definition and the item's current state (allowed transitions only). Do not rely on prose rules.
4. **Reuse** `agent_watches`/wake/cron for reactions and fix the two defects from `workflow-engine-review.md` first.
5. **Measure**: record tokens, $, transitions, reopens and wall time per item, so that two processes can be compared on the same backlog. That is the experiment the 132-run study did.
6. Ship 4 processes (waterfall, spec, agile, swarm/hierarchical). Do not build a BPMN-like DSL.
