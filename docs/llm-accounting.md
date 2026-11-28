# Local LLM accounting (opt-in)

This work is separate from the subscription quota indicator. Quota snapshots describe the remaining allowance; the accounting ledger describes actual model operations and the usage reported by their providers. Neither is an invoice or a currency estimate.

## Activation and access

Collection is **off by default** (`llmUsage.enabled=false`). Code reload alone does not activate it. There is no automatic schema migration: `llmUsage.setup({ confirmed: true })` creates the two tables and indexes only after an authenticated instance owner explicitly approves provisioning. It does not enable collection. Enabling the declared setting is a separate owner decision. The non-scanned `schema.entry.ts` is an isolated-test fixture, not a startup migration.

`llmUsage.page` is a Canvas `@view`; `llmUsage.report` supplies its aggregates. Both re-authenticate the actual HTTP request and require an active instance owner. A supplied `session.user` or `rpc.render` override is not sufficient; agent and request-less calls are rejected. This is an endpoint authorization boundary, **not tenant isolation** from trusted operators who already have generic SQL, REPL or filesystem access. The ledger contains sensitive account/client/agent identifiers even though it contains no conversation text.

The page supports a bounded UTC reporting interval and filters for source, authenticated node client, local agent, provider, model and account. It shows logical outcomes, physical attempts, reported tokens, missing-usage coverage, a trend and ranked groups. Filters on attempt dimensions match distinct logical calls; grouped call counts are not additive when one call tries several providers/accounts/models.

## What counts

- One `llm.call`, `llm.stream` or explicit compaction operation is one logical call. Its HTTP credential retries, quota failover and model fallback are separate physical attempts, not extra logical calls.
- A terminal node relay records one logical call per authenticated incoming model HTTP request, using the **immediate** client and actual upstream provider/account. Its own credential/quota retries are attempts. A retry initiated by the remote client is another incoming request: no origin correlation ID is transmitted, so these cannot be merged into the client's original logical operation. Do not add logical-call totals from different instances. A chained forwarding hop does not record provider expenditure. The original client or original agent behind several hops is not asserted or trusted from a request header.
- Local `hyper/...` execution remains visible as remote activity, but tokens from remote attempts are excluded from this instance's expenditure. If that operation falls back to a local provider, its actual direct attempts are included; the informational remote-call count can therefore overlap with counted logical calls. The terminal serving instance records the direct provider attempt. This does not implement a federated cross-instance accounting database.
- `/models`, `/usage`, catalogue refresh, OAuth refresh and reset-credit actions do not become model-call records. Rejected requests that never resolve to an entitled model are not model operations.
- Mock calls are excluded. Cursor uses the SDK's reported usage: a final cumulative result replaces, rather than adds to, per-turn observations. SDK invocations are not claimed to expose all internal model/network attempts.
- HTTP status alone is not completion. Streaming usage is observed in the returned byte stream, with terminal/error/cancellation handling. A logical relay is not marked successful merely because response headers arrived.

## Tokens and incomplete data

Tokens are taken from bounded JSON/SSE provider usage fields, never estimated from text, quotas or historical HTTP logs. Input, output, cache-read and cache-write are independently nullable. **Unknown is not zero.** A measured zero remains zero. Partial streams retain only the fields actually observed; missing fields and pending calls are visible.

Anthropic input excludes cache-read/cache-write, which are separate counters. OpenAI-style prompt/input totals include cached input; where the necessary fields are reported, the ledger subtracts cache-read from input so categories are not summed twice. Cumulative usage events replace earlier counters rather than being added again. Unsupported or inconsistent fields are left unknown. If OpenAI omits cached-input detail, noncached input remains unknown rather than being falsely reported as the total input. Token totals include reported usage of failed direct attempts as well as successful ones. Parsing is capped at 256 KiB for a JSON body and 64 KiB per SSE line/event; usage inside an oversized body/frame is unknown even when protocol completion is recognized.

The period is based on logical call start time, including the matching attempts belonging to those calls. There is no historical token backfill: old relay logs can establish requests in their own scope, not consumed tokens. `llm_node_clients.requests` is not a model counter because authentication also increments it for catalogue and quota endpoints.

## Privacy, reliability and limits

Persisted columns are allowlisted identifiers, timestamps, statuses, HTTP status and token counts. Prompts, completions, tools, request/response payloads, URLs, headers, credentials and raw error strings are not stored. A bounded stream observer parses transient bytes without teeing or keeping a second whole stream; it must preserve passthrough bytes, backpressure and cancellation.

Accounting is fail-open: storage failure must not replay, cancel or replace a model operation. Bounded recording waits can leave incomplete/pending records during database failures or process crashes. This is operational visibility, not a lossless billing system. No automatic retention/deletion, currency conversion, pricing catalogue or global aggregation is included. Decide retention before long-term activation; do not delete historical rows silently.

## Quota UI

Ordinary quota pressure is passive: one compact neutral ring in the left rail, with percentages and reset times in its tooltip/popover. Crossing an ordinary threshold no longer sends a warning toast. Exhaustion/parking remains visible; unrelated errors and notifications are unchanged.
