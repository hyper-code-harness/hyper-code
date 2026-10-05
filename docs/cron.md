# Embedded cron tasks

Hyper executes durable background runtime functions with an embedded worker in the HTTP Bun process.

## Storage model

Cron uses two Postgres tables:

- `cron_tasks` — one row per task: function, arguments, schedule, `next_run_at`, operational `enabled` status, worker state, and declaration source;
- `cron_runs` — immutable execution history with scheduled/start/finish times, status, result, and error.

Recurring definitions live in `$cron_<name>.ts` files. hyper-code itself ships none: a schedule
is a decision of one workspace, so declare it in a user plugin (`$USER_PLUGINS/<plugin>/src/<mod>/`)
or in the project `.hyper/` root — every instance running the shared code would otherwise run it too.

```ts
// $USER_PLUGINS/schedules/src/schedules/$cron_rss-sync.ts
export default { fn: "rss.loadAll", every: "8h", args: {} };
```

The `$loader_cron.ts` loader collects definitions and `cron.reconcile` loads them into `cron_tasks`. File definitions own `fn`, `args`, and interval. The database owns operational state, especially `enabled`, `state`, and `next_run_at`. Reconciliation preserves an existing task's enabled status and next run. Removing a declaration disables its task rather than deleting history.

Tasks created through `cron.add` or `cron.defer` have source `adhoc` and live entirely in Postgres.

## API

```ts
await ctx.fns.cron.add({
  name: "calendar-sync",
  fn: "google.syncCalendar",
  every: "15m",
  args: { account: "default" },
  now: true,
});

await ctx.fns.cron.defer({
  name: "calendar-once",
  fn: "google.syncCalendar",
  in: "30m",
  args: {},
});

await ctx.fns.cron.list({ limit: 100 });
await ctx.fns.cron.runs({ name: "calendar-sync", limit: 100 });
await ctx.fns.cron.runNow({ name: "calendar-sync" });
await ctx.fns.cron.setEnabled({ name: "calendar-sync", enabled: false });
await ctx.fns.cron.remove({ name: "calendar-sync" });
```

Intervals accept positive seconds or strings such as `1d`, `30m`, and `1h30m`.

## Execution

The worker atomically claims one due enabled `cron_tasks` row, switches it to `running`, and inserts a `cron_runs` row in the same statement. It invokes the registered runtime function and records `done` or `error`. An interval task receives a new `next_run_at` after completion, giving fixed-delay semantics. A one-shot task becomes disabled after its run.

On startup, interrupted running rows are marked as errors and tasks return to `idle`. The worker polls Postgres at most every 30 seconds and also uses an in-process wake signal. It runs up to four jobs concurrently. A hanging function cannot be forcibly killed; subprocess isolation remains future work.

## UI

Open `/cron` or choose **cron tasks** from global navigation. The main page shows one row per task with:

- enabled/disabled and worker state;
- next execution and interval;
- latest run status/error;
- `Run now` and `Enable/Disable` controls.

Selecting a task opens `/cron/:name`, which shows the definition and run history. The forms create ad-hoc recurring and relative one-shot tasks.

## Limitations

- Set `CRON_WORKER=off` to disable execution in a process.
- Only one embedded scheduler owner should be enabled.
- Cron expressions, time zones, retries, hard timeouts, and retention policies are not implemented.
- Results larger than 8 KiB are replaced by a truncation marker.
