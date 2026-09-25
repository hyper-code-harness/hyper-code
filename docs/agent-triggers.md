# Agent triggers

Agent triggers are the durable mechanism for starting a future turn in the same agent conversation. They replace separate wake-up, recurring schedule, and condition-watch concepts with one Postgres-backed engine.

## Public API

```ts
// One future turn: provide exactly one of at or inMs.
await ctx.fns.agent.wake({
  id: agent.id,
  inMs: 10 * 60_000,
  prompt: "Check the build",
});

// Recurring wall-clock schedule. Cron has five fields; timezone is required.
await ctx.fns.agent.cron({
  id: agent.id,
  expression: "0 9 * * 1-5",
  timezone: "Europe/Lisbon",
  prompt: "Prepare the morning update",
});

// Durable condition polling.
await ctx.fns.agent.watch({
  id: agent.id,
  predicate: "file.exists",
  opts: { path: "/tmp/result.json" },
  prompt: "The result is ready",
  everyMs: 30_000,
  timeoutMs: 60 * 60_000,
  mode: "once",
  onTimeoutPrompt: "The result did not arrive in time",
});

await ctx.fns.agent.triggers({ id: agent.id, status: "active" });
await ctx.fns.agent.cancelTrigger({ id: agent.id, triggerId });
await ctx.fns.agent.cancelAllTriggers({ id: agent.id });
```

Supported watch predicates are `file.exists`, `db.rows`, `http.ok`, and `runtime.fn`. `mode: "once"` completes after the first true result. `mode: "edge"` fires on each false-to-true transition and does not fire repeatedly while the condition remains true.

Legacy `wakeAt`, `wakeIn`, `wakeUpWhen`, and `cancelWake` calls are compatibility wrappers over this engine. New code should use `wake`, `cron`, and `watch`.

## Persistence and delivery

`agent_triggers` stores the trigger definition, lifecycle, next due time, claim token, timeout, and watch edge state. `agent_trigger_runs` is the durable execution history and idempotency record. The main agent worker includes the earliest active trigger in its sleep deadline and atomically claims due rows with `FOR UPDATE SKIP LOCKED`.

A firing appends a synthetic user-role message with `message_type="trigger"` and `excluded_from_cursor=true` to the existing agent session, then sets `agents.next_run_at`. It never creates a fresh conversation. One-shot triggers complete; cron triggers calculate their next wall-clock occurrence; failed checks use bounded retry. Abandoned claims are recovered after ten minutes.

Cron uses explicit IANA timezones. If the process was unavailable at a scheduled time, one due occurrence is delivered on recovery and the following occurrence is calculated from the recovery time, so missed runs do not create an unbounded backlog.

## Inspector UI

The right-side **Automation** section is the single control surface for Wake-up, Schedule, and Watch triggers. It lists active triggers and supports Run now, Cancel, Cancel all, and creation of all three types. Function retrieval and reranking controls live separately under **Agent settings**.
