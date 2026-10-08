# The decision layer and its engines

Companion to `docs/jev-decision-layer.md`, which argues *why* a typed decision
model belongs in Hyper. This document describes what is actually built: one
engine-neutral API in `src/decision/`, and two backends behind it.

## Why an abstraction appeared

`jev.decide` was a single HTTP boundary against one vendor. On 2026-10-07 OpenAI
shipped the Decisions API — the same idea, multimodal, on `POST /v1/decisions`.
Two vendors with one shape of problem means the vendor name must stop appearing
in call sites. So the wire contract moved one level down and became replaceable.

## Shape

```
src/decision/
  Question.ts           portable question: predicate|noul, choice, score
  Answer.ts             portable answer: noul+probability, choice, score
  Entry.ts              text or JSON accepted anywhere natural language is taken
  Engine.ts             "jev" | "openai"
  Result.ts             answers + engine + model + usage + latency
  post.ts               shared transport: timeout, retry on 429/5xx only
  engineJev.ts          Jev System One: POST /systemone, questions as a map
  engineOpenai.ts       OpenAI Decisions: POST /v1/decisions, questions as array
  ask.ts                THE entry point: validate, pick an engine, normalize
  $setting_engine.ts          default engine, "jev"
  $setting_openaiEndpoint.ts  https://api.openai.com/v1/decisions
  $setting_openaiModel.ts     gpt-6-luna
```

`jev.decide` still exists and still works — it is now a thin wrapper that pins
`engine: "jev"`. All fifteen existing call sites were left untouched on purpose:
the migration is a change of implementation, not of contracts.

## The two engines differ in exactly four places

| | Jev System One | OpenAI Decisions |
|---|---|---|
| evidence field | `state` | `input` (string, or message parts with images) |
| questions | map keyed by caller id | array, each with its own `name` |
| yes/no primitive | `noul`, answer field `noul` | `predicate`, answer field `probability` |
| choice / score options | rubric record / ordered list | `choices: [{value, description}]` / `levels: [{label}]` |

Everything else — probability distributions, `confidence`, score as a
probability-weighted average over indices starting at 0 — already agreed. The
portable `Question` accepts both `noul` and `predicate` as the yes/no type name,
and every `Answer` of that kind carries the probability under **both** names, so
code written in either vocabulary keeps reading.

An OpenAI `refusal` answer has no value at all. It is normalized to a yes/no
answer with probability 0 — "condition not established" — so one refused
question cannot crash a batch of five.

## Engine selection

1. `opts.images` present → `openai`, unconditionally. Jev is text-only and would
   drop the images in silence, which is the one failure worth preventing in code
   rather than in documentation.
2. `opts.engine` → explicit caller choice.
3. `decision.engine` setting.
4. `jev` — the cheapest.

## Cost, measured

Both engines bill input tokens only; output is free on both.

| | price / 1M input | same 413-token request | latency observed |
|---|---|---|---|
| `typesafe/jev-1.13` | $0.042 | $0.0000173 | 350–500 ms |
| `gpt-6-luna` | $0.10 ($0.05 batch) | $0.0000413 | 150–370 ms |

OpenAI is ~2.4× the price per token and, on these samples, not slower. What the
money buys is images, Zero Data Retention, HIPAA eligibility and US/EEA data
residency. For the high-frequency, low-stakes gates that dominate our traffic,
Jev remains the default on price alone.

`engineOpenai` computes `usage.cost` locally from the published beta rate
($0.10/1M input), because the endpoint does not return a cost field. Long-context
and regional-processing multipliers are *not* modelled — treat the number as a
floor, not an invoice.

## Credentials

Already provisioned, nothing to do:

- `llm.openaiApiKey` → `secret://llm/openaiApiKey` — used by the openai engine;
- `llm.openrouterApiKey` — used by the jev engine on the default OpenRouter route;
- `jev.apiKey` — only when `jev.endpoint` points straight at TypeSafe.

## Testing

`src/decision/decision.test.ts` drives both engines through a mocked `fetch` and
asserts the translation in both directions, the refusal path, the image path,
input validation before any request, and the retry policy. Nothing in the suite
reaches a real provider.

## What is deliberately not here

- No caching. Jev is non-deterministic (1.7–3.3% label flips on identical input);
  a cache would freeze one sample of a distribution. Open question from
  `jev-decision-layer.md` §8, still open.
- No trace table yet. §6 of that document asks for one and it is still the right
  thing; `Result` already carries engine, model, usage and latency, which is the
  row such a table would store.
- No automatic failover between engines. A decision that silently changes vendor
  changes its calibration, and thresholds are tuned per engine.
