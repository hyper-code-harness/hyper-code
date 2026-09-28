# Context compaction

## Goal

The **Compact context** action (and automatic compaction after a run) creates a hidden fork holding one checkpoint message and atomically switches the logical agent's model projection to `checkpoint + recent verbatim tail`. The durable root transcript, URL, queue, Team identity, settings and wake-ups do not move.

HOW the checkpoint is made depends on the provider and is pluggable through `$compaction_<provider>.ts` files (see *Compactors*): Codex and Claude compact natively on the provider's server, everything else gets a text handoff summary. Everything else on this page — tail selection, generations, CAS activation — is shared.

Manual and automatic compaction are implemented. Idle agents may also start background sleep compaction through `agent.sleepIdle` when `sleep_enabled` is true (default scan policy: 15 minutes idle, at least 20 messages). Compaction in the middle of an active turn, automatic tool-result microcompaction and user-facing rollback remain future work; see `continuous-context-compaction.md`.

## Minimal storage model

Reuse the existing `agents`, `messages`, fork fields and compact `sleep_context` projection instead of introducing `agent_contexts` or routing new messages to another agent.

- Root agent remains the stable logical identity and receives all future messages/events.
- A hidden child agent is created with `parent_id = root.id`, `fork_offset = 0` and compaction metadata in scratchpad.
- The child owns one synthetic checkpoint message: `compaction_summary` (text), `codex_compaction` (opaque Codex item) or `anthropic_compaction` (signed Claude block).
- Root `sleep_context` stores a compaction generation pointing to the child and a retained suffix in the root transcript.
- `buildLlmRequest` already supports this shape: context-agent messages followed by root messages from `tailStart`.

Generation metadata should include:

```ts
{
  revision: number,
  kind: "compaction",
  status: "draft" | "active" | "stale" | "failed",
  contextAgentId: string,
  sourceAgentId: string,
  sourceOffset: number,
  sourceFrontier: number,
  tailStart: number,
  summary: string,
  instructions?: string,
  tokensBefore: number,
  tokensAfter: number,
  model: string,
  compactor?: string,        // provider key of the $compaction_ file used
  createdAt: number,
  activatedAt?: number
}
```

The hidden child must not appear in Team or navigation. Mark it with `scratchpad.compaction` rather than delegation metadata.

## Effective context

After activation the model receives:

```text
current bootstrap/system/runtime prompt
compaction summary message from hidden child
root transcript from tailStart onward, verbatim
```

The user-facing transcript remains unchanged and receives only a `compaction_completed` event/card.

Repeated compaction summarizes the **current effective projection**, not the entire physical root transcript. Existing active compact projection therefore becomes the summarizer input together with its retained root tail.

## Safe retained tail

Target approximately 30k tokens, capped at 40k, with at least five text-bearing messages when available. A rough character/token estimate is acceptable for v1.

Choose the boundary while preserving native tool protocol:

- never start at a `role="tool"` result;
- never leave an assistant `tool_calls` message without all corresponding results;
- move the cut backward until the boundary is outside a call/result group;
- validate final projection with `session.repairToolPairs` or an equivalent non-mutating pairing check.

If there is not enough removable history, return `not_needed` and do not create/activate a generation.

## Compactors

`agent.compactContext` does not know providers. It calls `compaction.resolve({ model })`, which returns the compactor registered for the model's provider (`codex/work:gpt-5` → `codex`) or, failing that, `default`. Compactors are declared by files, collected by `src/compaction/$loader_compaction.ts` into `ctx.state.compaction.compactors`:

| File | Provider | Checkpoint |
|---|---|---|
| `compaction/$compaction_default.ts` | anything without its own file | text summary, `compaction_summary` |
| `llm/$compaction_codex.ts` | `codex` | native server checkpoint via `llm.compactCodex`, `codex_compaction` |
| `llm/$compaction_anthropic.ts` | `anthropic` | native server block via `llm.compactAnthropic`, `anthropic_compaction` |
| `llm/$compaction_claude-code.ts`, `$compaction_anthropic-oauth.ts` | Claude subscriptions | same as `anthropic` |

A compactor is `types.compaction.Compactor`: `(ctx, session, { model, sessionId, instructions, focus?, messages, signal? }) → { message, summary }`. `message` is stored in the hidden child and replayed before the tail; `summary` is the human-readable text shown on the `compaction_completed` card. A plugin or `.hyper/` may add a provider or override `default` — later roots win by name, like `$fence_`.

### default — text handoff summary

Ported from Codex's local compaction (`codex-rs/core/src/compact.rs`, prompts in `codex-rs/prompts/templates/compact/`). `llm.call` without tools, the agent's own model, the compaction child id as session id, Codex's `SUMMARIZATION_PROMPT` (plus “recent messages are preserved verbatim; do not continue the task”) and the popup focus appended as *Focus instructions*. The stored message is Codex's `SUMMARY_PREFIX` + summary. Empty output is rejected. When the summarizer itself overflows (`prompt is too long`, `context_length_exceeded`, 413), the oldest item is dropped — never leaving an orphan tool result first — and the call retried, as Codex does, so a transcript larger than the window still compacts.

### codex — server checkpoint

`llm.compactCodex` posts the transcript with a trailing `{type:"compaction_trigger"}` to the ChatGPT Responses endpoint and returns an encrypted `{type:"compaction", encrypted_content}` item. `toCodexInput` replays it as a `compaction` input item. It is opaque: the card shows only the response id.

### anthropic / claude-code — server compaction block

Anthropic beta `compact-2026-09-04` (works with API keys and Claude subscription OAuth; verified on `claude-opus-5`). `llm.compactAnthropic` sends the transcript with top-level `compaction: {type:"summarize", instructions?}` and gets back `stop_reason:"compaction"` and one signed block `{type:"compaction", content:"<summary>…", signature}`; the summary is readable and shown on the card. Rules learned against the live API:

- The block must be the **first content block of the first message** (“in place of the messages it summarizes”); anywhere else is a 400. `toAnthropicMessages` hoists it in front of the bootstrap turn; the system prompt may differ from the one at compaction time.
- Replaying requires the `compact-2026-09-04` beta header too (else 400 “Input tag 'compaction'…”); `streamAnthropic` adds it whenever the request starts with a compaction block.
- `compaction.instructions` **replaces** the server prompt (≤16,384 chars), so a popup focus is wrapped into a full handoff prompt.
- Too small `max_tokens` returns 200 with empty content and `stop_reason:"max_tokens"`; we send 32k. Empty content (also refusal / overflow) throws, and `$compaction_anthropic` falls back to `default`.
- The agent's system prompt is **not** sent to the summarizer: output-format rules (respondHtml…) leaked into the summary.
- Summarizer tokens are reported only in `usage.iterations[type=compaction]`; top-level usage is zero.
- The older `compact-2026-01-12` mechanism (`context_management.edits: [{type:"compact_20260112"}]`, threshold-triggered mid-response) is accepted too but not used: it compacts inside a turn, outside our generation/CAS model.

### Switching models after compaction

Checkpoints are model-bound, so `compaction.portable({ model, producedBy, messages })` adapts the stored checkpoint to the model about to read it. `buildLlmRequest`, `compactContext` and `autoCompactIfNeeded` all use it, so they share one view of the context:

- the exact model that produced a native checkpoint gets it unchanged;
- a Claude `anthropic_compaction` block for any other model — including Claude models without the compact strategy (haiku rejects it with 400) — becomes a text `compaction_summary` (the block's readable summary + `SUMMARY_PREFIX`);
- an opaque `codex_compaction` item for any other model is unusable, so the projection falls back to the full root transcript (never modified).

`agent.setModel` then runs `autoCompactIfNeeded` in the background, so a fallback that is too large for the new window gets re-compacted by the new model's compactor before the next turn. Verified live: one agent switched opus-5 → haiku-4.5 → codex gpt-5.6 → opus-5-5 → opus-5 answered correctly after a Claude compaction every time.

## Transactional activation

1. Require root `run_state = idle` and no compaction already running.
2. Resolve the current effective model projection.
3. Snapshot root message frontier and current active compact revision.
4. Choose safe `tailStart`.
5. Create hidden draft child and run summarizer outside a DB transaction.
6. Persist summary on hidden child.
7. CAS activation only if:
   - root is still idle;
   - root message frontier is unchanged;
   - active compact revision/head is unchanged.
8. On CAS failure mark draft `stale`; old projection remains active.
9. On summarizer/cancel failure mark draft `failed`; old projection remains active.
10. On success append `compaction_completed` event with token/message metrics.

No destructive message replacement is allowed.

## Runtime API

```ts
agent.compactContext({
  agent,
  instructions?: string,
})
```

Return:

```ts
{
  status: "compacted" | "not_needed" | "stale",
  revision?: number,
  tokensBefore: number,
  tokensAfter?: number,
  keptMessages?: number,
  summary?: string
}
```

Legacy `agent.compact` (shrink the last tool result) is unrelated and unchanged.

## Automatic compaction

After every successful run `workerLoop` calls `agent.autoCompactIfNeeded({ agent })` in the background. It skips busy agents, agents with no compactor, and projections that are already compact. Threshold = the lower of

- setting `agent.autoCompactTokens` (absolute, default 700k), and
- setting `agent.autoCompactWindowPercent` (default 80) of `compaction.contextWindow({ model })` — Claude 200k, Codex/GPT-5+ 272k, some long-context families 1M, common open models 128k, `null` (no window limit) when unknown.

Size = max(chars/4 estimate of the effective projection, provider-reported prompt+completion tokens of the last assistant event). The reported figure is ignored when it predates the active compaction, otherwise compaction would repeat. Failures become an `auto_compaction_failed` event and never fail the user turn.

## UI

The button lives in `src/ui/chatColumn.ts` beside Sleep / Initial Prompt / Fork:

```text
Compact context
```

It opens a small popup/form with optional focus instructions and a Compact submit button. Routes (the mobile API has the same one):

```text
POST /agent/:id/compact
POST /api/mobile/v1/agents/:id/compact
```

Disable/reject while the root is running. Show lifecycle events:

- `compaction_start`: spinner/card, optional cancellation later;
- `compaction_completed`: `124k → 31k`, retained message count, expandable summary;
- `compaction_failed`: context unchanged;
- `not_needed`: concise notification.

V1 may use an HTMX form and synchronous POST if it remains safe; do not inject a normal user message to trigger compaction.

## Tests required

1. Successful compaction produces `summary + verbatim tail` in `buildLlmRequest` while root messages remain unchanged.
2. Tail selection does not split assistant tool calls from tool results.
3. A root message arriving during summarization causes CAS failure/stale draft and leaves old projection active.
4. Summarizer failure leaves old projection active.
5. Repeated compaction summarizes the current effective projection.
6. Hidden compaction child is absent from Team/navigation.
7. Button and POST route smoke tests.
8. Restart/load preserves the active compact projection.

## Still out of scope

- compaction during an active run (the window-aware threshold is checked only after a run);
- exact per-model windows from provider catalogues (`compaction.contextWindow` is a family table);
- automatic Claude-style tool-result clearing;
- semantic retrieval and context-tree capsules;
- user-facing rollback/version selection;
- migration of ordinary user forks;
- destructive changes to the durable transcript.
