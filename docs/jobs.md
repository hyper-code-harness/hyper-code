# Jobs: background work, wake-ups, schedules, watches, subscriptions

Everything an agent has running or scheduled is a row of one Postgres table, `jobs`. When a job ends or fires,
the agent gets one message in the same conversation and a turn is queued. The agent never sleeps or polls: it
ends its turn and the message arrives.

## One way for each thing

| I want to… | Call | Row (`kind` / `runner`) |
|---|---|---|
| run a long command (here or on an SSH host) | `bash({ command, background: true })` | `exec` / `bash` |
| run it, but get the result directly if it is quick | `bash({ command, background: { afterMs, wake } })` | `exec` / `bash` |
| run long eval code | `eval({ code, background: true \| { afterMs, wake } })` | `exec` / `bash` |
| be woken once, at a time or after a delay | `agent.wake({ id, at \| inMs, prompt })` | `schedule` / `at` |
| be woken on a cron schedule | `agent.cron({ id, expression, timezone, prompt })` | `schedule` / `cron` |
| be woken when a condition turns true | `agent.watch({ id, predicate, opts, prompt, … })` | `schedule` / `watch` |
| be woken by external events (plugin `$attach` sources) | `agent.attach({ id, source, events?, filter?, prompt? })` | `subscription` / `attach` |
| see all of the above | `jobs.list({ status? })` | |
| read a command's output | `jobs.logs({ id, offset?, limit? })` | |
| stop any of the above | `jobs.cancel({ id })` — silent, no completion message | |

Services that must keep running (databases, dev servers) are not jobs: they are hyperd units (`docs/hyperd.md`).

## Background commands

```ts
bash({ command: "bun test", timeout: 600, background: true })
// done within 30 s → the normal result; still running → a job id, and later a message carrying `wake`
bash({ command: "bun test", timeout: 600, background: { afterMs: 30_000, wake: "Tests finished. Inspect failures and fix them." } })
eval({ code: "await crawl(); console.log('done')", background: true })
```

- A bash job runs detached (tmux session `hj-<id>`, or a hyperd unit with the setting `jobs.backend = hyperd`;
  SSH hosts always use tmux). Output goes to `~/.hyper-jobs/<id>/out.log`. It survives a Hyper restart.
- The completion message has status, exit code, duration and the last ~4 KB of output; `jobs.logs` reads the rest.
  Jobs that end within 2 s of each other arrive in one turn.
- `background: { afterMs }`: the job starts at once and the call blocks up to `afterMs`. A command that ends in
  time returns its normal result and sends no message. `timeout` kills the process; `afterMs` only stops blocking.
- Env and secret values reach the process through a 0600 launcher file that deletes itself first; `ps` and tmux
  never see them, and secret values are replaced with `[REDACTED]` in everything the agent reads.
- Past `timeout` (default 24 h) a job is stopped and reported as `timeout`; a vanished process is `lost`.
  Unreachable SSH hosts are retried with backoff until the deadline.
- `eval` in the background is its own bun process, started as a background bash job: the code is transpiled (and
  typechecked) at the call, written to a self-deleting 0600 script, and run with `bun`. Its `ctx.fns` calls go to
  `POST /jobs/eval` (loopback only, a token signed by this run for the agent, the same access check as `/rpc`)
  and run with the agent's session; `agent` is a JSON snapshot, `ctx.state` is not available. Printed output goes
  to the job log; exit 0, or 1 with the stack when it threw. Cancel kills it; a server restart does not.
- The "to background" button on a running local bash call adopts a call already running inside the server
  (`attached`): it cannot be moved to another process, so a server restart reports it `lost`.

## Wake-ups, cron, watches

```ts
await ctx.fns.agent.wake({ id: agent.id, inMs: 10 * 60_000, prompt: "Check the build" })      // or at: epoch ms
await ctx.fns.agent.cron({ id: agent.id, expression: "0 9 * * 1-5", timezone: "Europe/Lisbon", prompt: "Morning update" })
await ctx.fns.agent.watch({
  id: agent.id, predicate: "file.exists", opts: { path: "/tmp/result.json" },
  prompt: "The result is ready", everyMs: 30_000, timeoutMs: 3_600_000, mode: "once",
  onTimeoutPrompt: "The result did not arrive in time",
})
```

- Cron has five fields and an explicit IANA timezone. After downtime one missed occurrence is delivered, not a
  backlog.
- Watch predicates: `file.exists { path }`, `db.rows { sql, params? }` (one SELECT), `http.ok { url }`,
  `runtime.fn { name, args?, callTimeoutMs? }` — a registered function returning `{ ready, result? }`; it stores the
  name and JSON args, never code. The predicate is evaluated once before the watch is saved, so a broken one fails
  the call. `mode: "once"` completes on the first true; `"edge"` fires on each false→true transition. Predicate
  errors back off from 1 to 15 minutes. Results over 16,000 characters are stored in the immutable result store and
  `job_runs.result_ref` points to them.
- A firing appends a user-role message (`message_type = "trigger"`) to the same conversation.
- The agent inspector's **Automation** section lists them, with Run now, Cancel, Cancel all, Add, and an audit popup
  of past runs.

## How it runs

- `agent.workerLoop` calls `jobs.poll` on every pass and sleeps until the earliest `next_at`. Due rows are claimed
  with a short lease (`FOR UPDATE SKIP LOCKED`), so two workers never handle the same job.
- Every message goes through `agent.deliver`: the inbox message, UI event, job state change, `job_runs` audit row
  and the wake-up commit in one transaction, keyed by job id (+ scheduled time). A crash or a second poller can
  neither lose nor double a message; a cancel that commits first wins.
- While an agent is parked on a provider usage limit its schedules wait; the parking wake-up is itself an `at` job.
- Archiving an agent cancels all its jobs (`jobs.cancelAgent`). Stopping a turn does not: jobs keep running and
  report back.

## Tables

- `jobs` — `id, kind, runner, spec, state, status, outcome_reason, owner_id, created_by, agent_id, prompt,
  origin_tool_call_id, execution_id, next_at, lease_token, lease_expires_at, cancel_requested_at, result,
  created_at, started_at, deadline_at, finished_at, updated_at`. `status`: `running` until the job ends, then
  `succeeded | failed | cancelled | timeout | lost`.
- `job_runs` — one row per firing of a schedule or subscription: `job_id, scheduled_at, outcome, result,
  result_ref, error`.

The old tables `agent_triggers`, `agent_trigger_runs`, `agent_watches`, `agent_attachments` and the column
`agents.wake_at` are gone: migrations in `src/jobs/` copy their rows into `jobs` and drop them at boot.
