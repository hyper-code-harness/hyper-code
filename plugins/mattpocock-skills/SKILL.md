---
name: mattpocock-skills
description: "Matt Pocock's engineering skills for coding agents, vendored verbatim: grill a plan or design by relentless interview, build a domain glossary and ADRs, test-first TDD at agreed seams, diagnose a hard bug through a feedback loop, review a diff on Standards and Spec axes, write skills and agent docs, turn a discussion into a spec and tracer-bullet tickets, retro a session. Use when the user says grill me, wants to stress-test a plan, asks for TDD, debugging discipline, a code review, or names one of these skills."
---

# mattpocock-skills

Vendors the **engineering** and **productivity** skills from **Matt Pocock**'s
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT) and serves them to Hyper agents.

- vendored copy: `vendor/mattpocock-skills/` (upstream `skills/engineering`, `skills/productivity`, `LICENSE`, `GLOSSARY.md`, README as `UPSTREAM-README.md`)
- pin: `vendor/mattpocock-skills/PROVENANCE.json` (commit, version, date, file list)
- `misc/`, `in-progress/`, `deprecated/` upstream buckets are left out, as upstream's own plugin does

No rule here is ours. The plugin returns the upstream text unchanged and adds, separately, a
short map from Claude Code words (Skill tool, sub-agent, issue tracker) to Hyper tools.

## Workflow

1. The person names a skill ("grill me", "/tdd", "do a code review") or the task clearly fits one → `list({ query })` if unsure of the name.
2. `get({ name })` and follow the returned `markdown` (and `called`) as your instructions for this task. Read `hyper` once: it says what to use instead of the Skill tool, sub-agents, the issue tracker and `$TMPDIR`.
3. For a long or parallel part (research, the two review axes, implementer per ticket) hand the skill text to a child via `agent.delegate`.
4. Skills marked `invocation: "user"` are flows the person chooses (`grill-with-docs`, `to-spec`, `implement`, `handoff`, `retro`, …). Offer them; do not start one unasked.

## Where to start

- A plan, design or idea to sharpen → `grilling` (in a repo, `grill-with-docs` — it also writes the glossary and ADRs).
- Which skill fits? → `ask-matt`, the upstream router over every flow.
- Something broken → `diagnosing-bugs`. Building test-first → `tdd`. Reviewing a branch → `code-review`.
- Writing a SKILL.md, CLAUDE.md or JSDoc for agents → `writing-for-agents` (+ `SKILL-MECHANICS.md`).

## Honest limits

- The skills are written for Claude Code / Codex: they speak of a Skill tool, slash commands and a per-repo
  `/setup-matt-pocock-skills`. The `hyper` mapping covers the gap; the text itself is not adapted.
- They are process, not enforcement. Code standards are checked by `code.quality` on every save; a skill
  only tells the agent how to work. An independent review (Scott Logic, Oct 2026) found the rituals are
  sound but no substitute for the person's judgement.
- The copy is pinned. Re-vendor from upstream to pick up changes; `about({})` shows the commit.
