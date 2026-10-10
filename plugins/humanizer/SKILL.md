---
name: humanizer
description: "Rewrite AI-sounding work text so it reads like a careful person wrote it, without changing a single fact, commitment or caveat. Use when the user wants text de-AI-ified, less slop, less ChatGPT tone, a plain human voice for an email, sales or marketing copy, support reply, HR or legal letter, release notes, LinkedIn or X post, landing page; when they want to know why a text sounds like AI; or when a thin AI draft needs the writer's own facts through an interview. Keywords: humanizer, humanize, de-slop, AI tone, AI detector, slop, rewrite, editing, copy, tone of voice, work writing, tells, em dash."
---

# humanizer

Wraps the **work-humanizer** Agent Skill — written by **Pawel Huryn**, MIT-licensed — as Hyper runtime functions in the `humanizer` namespace.

- upstream repo: <https://github.com/phuryn/work-humanizer>
- author's announcement: <https://x.com/PawelHuryn/status/2108511822445674638>
- vendored copy + commit pin: `vendor/work-humanizer/` and `vendor/work-humanizer/PROVENANCE.json`

The skill's own text is the instruction set; this plugin only ships it to a model, runs its mechanical checker, and keeps the attribution attached. No rule here is ours — `humanizer.skill({})` returns the upstream wording verbatim.

## The idea in one paragraph

Asking a model to "make this sound human" changes what the text says: it apologizes where you only acknowledged, adds a condition to an offer, inflates a promise. In work writing the exact words are commitments, so work-humanizer does it the other way round: list every fact, number, promise and caveat with its level of certainty, write the piece fresh in the writer's voice, then audit sentence by sentence that nothing got stronger or weaker. It never claims to beat AI detectors — detectors read who composed the text, not which words it uses. For text that is genuinely the writer's own, use interview mode.

## Functions

Deterministic, offline, no model call
- `humanizer.check({ text | path })` — the upstream `check.py` sweep: dashes, semicolons, stock AI vocabulary, marketing register, filler transitions, pause-and-point lines, hedges, sentence band → `{ findings, sentences, words }`
- `humanizer.tells({ text, categories? })` — every `tells.md` phrase with its offset, line and category (ai-vocabulary, marketing, transitions, pause-and-point, closers, hedges, attribution, chat-residue) → `{ hits, byCategory, total }`
- `humanizer.rhythm({ text })` — section E arithmetic: median sentence length, share within ±5 words, repeated openers, longest/shortest → `{ bandShare, uniform, direction, verdict }`

One skill step each, with an LLM
- `humanizer.triage({ text })` — step 1 + the mode test: could anyone with the same one-line request have written this? → `{ mode, genre, reader, placement, missing, reason }`
- `humanizer.facts({ text })` — step 2: the fact register with certainty and the writer's own qualifiers → `{ facts, counts }`
- `humanizer.interview({ text, max? })` — up to 5 cheap questions only the writer can answer → `{ questions, reason }`
- `humanizer.compose({ facts?, notes?, answers?, checklist?, genre?, reader?, placement?, language? })` — step 3: write it fresh, never patching the AI sentences → `{ text, words }`
- `humanizer.audit({ original, rewritten })` — the fact audit over any pair of texts: certainty raised or lowered, added reasons and conditions, changed actor, invented specifics, missing facts → `{ ok, changes, missing, added }`
- `humanizer.shorten({ text, write? })` — final check 7: cut candidates with word counts, offered and not applied → `{ offer, candidates, share, line }`

Pipeline and metadata
- `humanizer.rewrite({ text, notes?, genre?, reader?, force?, skipAudit?, shorter? })` — triage → facts → compose → audit → check → rhythm → shorten, with a `trace` of every stage → `{ text, audit, checked, rhythm, shorterOption, trace }`. Returns `interviewNeeded` with the questions instead of a rewrite when the draft needs the writer's own facts.
- `humanizer.skill({ part? })` — the upstream `SKILL.md` or `tells.md` verbatim
- `humanizer.about({})` — author, licence, upstream commit, vendored file list

## Workflow

1. `triage` first. Operational text with all its facts present (Slack update, support answer, release note) goes to `rewrite`. A post, newsletter, bio, pitch or launch story goes to `interview`.
2. Feed interview answers back as `compose({ answers, facts })`, or as `rewrite({ text, notes })`.
3. `audit` is useful on its own: any edit, translation or legal shortening can be checked against the original with it.
4. Always end on `check` and `rhythm`; eyes miss dashes, stock words and a flat band.
5. `shorten` offers cuts and never applies them — the decision is the writer's.

## Honest limits

- Not an AI-detector bypass. The upstream evidence shows every rewrite still reads as AI on Pangram; only text built from the writer's own sentences scores human.
- English-first. The tell lists and `check.py` vocabulary are English; on Russian text the LLM rules still apply but the mechanical sweep finds little.
- `check.py` needs `python3` on PATH.
