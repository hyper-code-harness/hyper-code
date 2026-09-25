# Jev decision layer

Design for integrating TypeSafe's Jev (a "System One" typed-decision model) into
Hyper as a user plugin, and for the four runtime call sites that justify it.

Status: design. Nothing implemented yet.

## 1. What Jev is

A model that does not generate text. It reads a `state` once and answers a map of
typed questions in parallel, returning a constrained value plus a calibrated
probability distribution. One HTTP round trip, no JSON prompting, no parsing, no
validation layer.

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <key>

{ "model": "jev-latest",
  "state": <string | object | array>,
  "questions": { "<id>": <Question>, ... } }
```

Three question primitives:

| type     | `criteria`                       | answer fields                                  |
|----------|----------------------------------|------------------------------------------------|
| `choice` | map option → description \| null | `choice`, `probabilities`, `confidence`         |
| `score`  | ordered level descriptions       | `score`, `legend`, `probabilities`, `confidence`|
| `noul`   | optional `{ true, false }`       | `noul` (0..1), no confidence                    |

Operational envelope of `jev-1.13.0`:

- price $0.042 / 1M input tokens, output free;
- context 64K per request, 32K for `state` + the single longest question;
- **255 options maximum** per Choice question;
- text only; rate limits 250k tok/s, 1200 rpm, `429` with `retry-after`;
- aliases `jev-latest` and `jev-preview` both resolve to `jev-1.13.0` today.

Also reachable through OpenRouter as `typesafe/jev-1.13` behind an
OpenAI-compatible endpoint, and reimplemented by open replicas that serve the
identical `/v1/systemone` contract (LitJev over any Qwen, Simple Jev over HF
logits, jevmlx on Apple Silicon MLX). **The contract is portable even though the
model is not open.**

## 2. Evidence base

Independent measurements, not vendor claims.

| source | finding |
|---|---|
| `4esv/jev-eval`, 300 items × 3 tasks vs GPT-5.6 Terra | median latency 0.20 s vs 1.04 s (5×); $0.04 vs $2.02 per 1k calls (~45×); accuracy 0.78 vs 0.85 on 77-way intent, parity on easy tasks; **non-deterministic**, 1.7–3.3% label flips on identical input |
| `baibizhe/jev-decision-benchmarks` (MetaTool, When2Call, BFCL V4) | tool selection 77.8% vs 69–73% ChatGPT; **abstention 87–88% vs 50–78%** |
| `RINNECODER/jev-behavior-study`, 432 permuted calls | accuracy 88% when the correct option is listed first, 57% when fourth — **option order is an experimental variable** |
| `yodablocks/jev-orderby-bench` | ranking by probability defensible on 20 Newsgroups, fails 4/6 conditions on Amazon ESCI; **40-row batching fails a gate that one-row-per-request passes** |
| community reranking evals | beats Voyage, Qwen3-Reranker and Cohere as a RAG reranker |
| vendor `model-jaggedness` page | literal reading, no reliable counting, no arithmetic or date math, degrades on indirection and on large states full of irrelevant detail |

Three engineering rules follow directly and are binding on every call site below:

1. **Decompose.** Many atomic questions in one fan-out call, combined by our own
   code, beat one compound question. (A published phishing benchmark went from
   63% to 95% purely by splitting one question into five.)
2. **Control option order.** Either fix a canonical order and record it, or
   randomize per call; never let retrieval rank silently become option order
   without measuring the effect.
3. **One item per request when ranking.** Do not batch candidates into a single
   scoring question and sort the result.

And one framing rule: a typed answer is a *guaranteed type*, not a guaranteed
truth. Calibration describes populations of answers, not the answer in hand.

## 3. Plugin shape

New user plugin at `~/.hyper/user/jev` — a private integration, so it belongs in
`USER_PLUGINS`, not in `plugins/` and not in project `.hyper/`.

```
~/.hyper/user/jev/
  package.json           procs: { src, label: "jev", icon: "ph-gauge",
                                  optional: true, description: ... }
  SKILL.md               workflow overview: when to reach for a typed decision
  src/jev/
    Question.ts          type: Choice | Score | Noul wire shapes
    Answer.ts            type: typed answers + probabilities + confidence
    $setting_endpoint.ts default https://api.typesafe.ai/v1/systemone
    $setting_model.ts    default jev-latest
    decide.ts            jev.decide  — the only function that talks HTTP
    gate.ts              jev.gate    — one decision + a three-band verdict
    pick.ts              jev.pick    — choose one of N candidates, with abstain
    rank.ts              jev.rank    — score candidates one request each
    health.ts            jev.health  — endpoint, model, key presence, latency
```

Credentials through the runtime secret store, never env:

```ts
await ctx.fns.secrets.putLocal({ namespace: "jev", name: "api_key", value })
```

Neither `TYPESAFE_API_KEY` nor `OPENROUTER_API_KEY` exists in the current
environment, so provisioning a key is step zero.

### `jev.decide`

The thin, honest wrapper. Everything else is built on it.

```ts
jev.decide({
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, types.jev.Question>,
  model?: string,          // default from $setting_model
  endpoint?: string,       // TypeSafe | OpenRouter | local LitJev
  timeoutMs?: number,      // default 5000 — this is a latency-critical path
}) => Promise<{
  answers: Record<string, types.jev.Answer>,
  usage: { inputTokens: number },
  latencyMs: number,
}>
```

Behaviour: retry on 429/5xx honouring `retry-after`, cap at two retries, never
retry a 4xx that is our own bad request. On any failure **throw** — callers
decide the fallback, because every call site below has a different safe default.

### `jev.gate`

Wraps one question plus the vendor's three-band confidence policy so thresholds
live in one place instead of being scattered through call sites.

```ts
jev.gate({ state, question, high?: 0.85, low?: 0.5 })
  => { value, confidence, band: "act" | "confirm" | "escalate" }
```

Thresholds scale with risk: a read-only route may act at 0.6; a `git push` gate
should not act below 0.9.

### `jev.pick`

Candidate selection with a mandatory escape hatch.

```ts
jev.pick({ state, candidates: Array<{ id, label, description? }>,
           instructions, abstain?: true, order?: "given" | "shuffle" })
  => { id: string | null, probabilities: Record<string, number>, confidence }
```

Enforces the 255-option ceiling, always appends a `__none__` option when
`abstain`, and records the option order it used in the returned trace so a
regression can be replayed.

### `jev.rank`

Reranking. Deliberately **not** a single batched call: one request per candidate,
issued concurrently with a small pool, each returning a Score or Noul. Sorting
happens in our code.

## 4. Call sites in Hyper

Ordered by ratio of value to risk. Each ships behind its own setting, default
off, with a measured baseline before it is turned on.

### 4.1 Rerank runtime function search (start here)

`docs/runtime-function-search.md` describes the current pipeline: BM25 and vector
branches with independent gates, RRF `k=60` for ordering only, at most five
injected candidates. `docs/function-rag-evaluation.md` records the calibrated
policy (`BM25 >= 8 OR cosine >= .35`, 0.923 query accuracy, 0.889 Recall@5,
1.0 no-result precision over 13 labelled cases) and one documented failure:
Russian `проверить почту` has no Gmail candidate above the cosine floor.

Proposal: keep retrieval exactly as it is, widen the eligible union to ~20, and
insert `jev.rank` as a **reranking stage before the top-5 cut**. One request per
candidate, question = "does this function perform the operation the user asked
for?" as a Noul over `{ query, name, summary, signature }`.

Why here first: it is the scenario where Jev is independently strongest, an error
costs one irrelevant tool schema, `runtime.docs.ragBenchmark` already exists as a
scoreboard, and the cross-language gap is exactly the kind of gap a semantic
reranker can close without touching the embedding model.

Acceptance: Recall@5 and query accuracy must not regress on the existing labelled
set, no-result precision must stay 1.0, and added latency must stay under 250 ms
p50 for the whole rerank stage.

### 4.2 Tool injection in `agent.wireTools`

Today `tools.schemas` / `tools.promptSection` decide what reaches the model. With
several hundred runtime functions plus plugin namespaces, every extra schema is
permanent context tax on every turn.

Proposal: after retrieval, one fan-out `jev.decide` carrying the user's last
message as `state`:

- `needs_tool` (Noul) — is any tool required at all?
- `which` (Choice over ≤20 retrieved candidates + `__none__`)
- `is_destructive` (Noul) — speculative, consumed only by 4.4

Inject the top candidates only when `needs_tool` is high; inject nothing when the
model abstains. This is precisely the MetaTool/When2Call shape where Jev measured
77.8% selection and 87–88% abstention against ChatGPT's 69–73% and 50–78%.

Risk: a wrong prune is invisible to the agent — it simply cannot see the tool it
needed. Mitigation: never prune below a floor of N candidates, always keep the
tools the agent used in the last three turns, and log every pruned-but-later-
requested function as a hard regression signal.

### 4.3 News triage

`news.items` currently gets LLM attention per item. One fan-out call per item at
~0.2 s and ~$0.00004 replaces it:

- `category` (Choice over the existing taxonomy, walked as a tree if it is deeper
  than one level)
- `worth_reading` (Noul)
- `urgency` (Score over described levels)
- `is_duplicate_of_known_topic` (Noul)

Speculative questions cost tokens, not latency, so ask them all and let code
decide. Confidence below the floor means "leave it for the existing LLM path",
not "guess".

### 4.4 Context and safety gates

Two small, high-frequency decisions where a 200 ms answer is the point:

- **Compaction trigger.** Score "how much of this transcript is still load-bearing"
  instead of a fixed token threshold; feed `agent.compact`.
- **Tool-result noise.** Noul "does this result contain information the agent will
  need later?" — decides stash-only versus inline, complementing the existing
  auto-stash preview mechanism.
- **Destructive action gate.** Before `git.push`, `files.remove`, `procs.db.exec`:
  `jev.gate` with `high = 0.9`. Low confidence escalates to the user rather than
  proceeding. Note this is a *second* line of defence; deterministic checks stay.

## 5. Fallback and portability

`$setting_endpoint` makes the backend swappable without touching call sites:

1. TypeSafe direct — best quality, needs a key, costs money;
2. OpenRouter `typesafe/jev-1.13` — same model, one key shared with other routes;
3. **local LitJev / Simple Jev / jevmlx** — same `/v1/systemone` contract over a
   local Qwen or ModernBERT-class model, zero marginal cost, useful for
   development and as a degraded mode.

Every call site must work with the plugin absent or the endpoint failing. The
fallback is always "current behaviour": full retrieval order, unpruned tool list,
existing LLM triage path. Jev is an accelerator, never a dependency.

## 6. Observability

Without measurement this is superstition. Every decision writes a trace row:
question ids, option order used, chosen value, full probability distribution,
confidence, latency, endpoint, model version. That is enough to:

- recompute calibration curves (does 0.8 mean 80%?) against outcomes we observe;
- detect drift when the `jev-latest` alias moves to a new model;
- replay an option-order permutation study on our own real traffic;
- decide thresholds from labelled data instead of taste — the same discipline
  `docs/function-rag-evaluation.md` already established for retrieval.

## 7. Plan

| # | step | done when |
|---|---|---|
| 0 | provision a key, store in `secrets` namespace `jev` | `jev.health` returns a latency |
| 1 | plugin skeleton, `jev.decide`, types, settings | `runtime.docs.validate` strict passes |
| 2 | `jev.rank` + rerank stage behind a setting | `ragBenchmark` ≥ current on all metrics |
| 3 | expand the labelled set beyond 13 cases, add Russian | measurable cross-language recall |
| 4 | `jev.pick` + `wireTools` pruning, shadow mode first | zero pruned-but-needed events over a week |
| 5 | news triage, then the gates | cost and latency deltas recorded |

Steps 2 and 4 each ship in shadow mode first: compute the decision, log it, do not
act on it. Compare against what actually happened, then enable.

## 8. Open questions

- Non-determinism (1.7–3.3% flips) interacts badly with caching — do we cache by
  `state` hash and accept staleness, or accept the flips?
- The option-order effect means retrieval rank leaking into option order may bias
  the reranker toward what retrieval already preferred. Needs an explicit
  experiment before 4.2.
- Is a 149M open replica on MLX good enough for 4.4's high-frequency, low-stakes
  gates? If yes, those never need to leave the machine.
