# Release notes

Newest first. One entry per change that someone using or running Hyper would notice: what changed, why, and
what to do (if anything). Internal refactors without visible effect do not need an entry.

## Unreleased

### hyperd: process supervisor for services and background jobs
- New `hyperd/` daemon: runs services, tasks and terminal sessions from unit files in `~/.hyper/units/`
  (YAML, JSON, TS), with readiness checks, `after` ordering, restart with backoff, logs by offset, an event
  journal, and a CLI (`bun hyperd/cli.ts`). Processes survive restarts of hyper and of hyperd itself.
- Install as an OS service: `bun hyperd/cli.ts install` prints the launchd (macOS) or systemd (Linux) file
  for this machine and the commands to install it; `bun hyperd/cli.ts doctor` checks the setup;
  `bash hyperd/smoke.sh` runs an end-to-end check in a throwaway home. See "Install" in `docs/hyperd.md`.
  Service names carry the user (`com.hyper.<user>-hyperd`, `hyperd-<user>`), so several users on one machine
  each get their own daemon. Installed as `com.hyper.hyperd` earlier: `sudo launchctl bootout
  system/com.hyper.hyperd`, remove its plist, install the new one — services keep running and are adopted.
- Agents control it through `ctx.fns.hyperd.*` (`status`, `run`, `start`, `stop`, `restart`, `reload`, `logs`,
  `send`, `events`). Docs: `docs/hyperd.md`.
- Setting `jobs.backend` (`tmux` default | `hyperd`): local background bash jobs run as hyperd units. SSH
  hosts still use tmux. Switch back by setting it to `tmux`.
- Safe by default: secrets passed with `run({ env })` stay in hyperd's memory and never touch disk; only one
  daemon runs per home (exclusive pid file plus a socket check); after a reboot a reused pid is not taken for
  a live process; if a holder dies, its orphaned process group is killed before a restart, so a service never
  runs twice. The daemon started on demand by hyper gets only a minimal environment, not the server's keys.
  Under launchd/systemd a second copy waits for the running daemon to exit instead of restart-looping.
- Background job units: a task without a pty gets no stdin (EOF at once, like tmux jobs); the last output is
  kept when a job ends; finished job units and their logs are removed after a day (`HYPERD_GC_MS`).
- Not yet: rotation of the event journal; Linux/systemd is covered by unit tests but not run live yet.
- To try it: `bun hyperd/cli.ts install`, follow the printed commands, `bun hyperd/cli.ts doctor`, then set
  `jobs.backend = hyperd`. Switch back by setting it to `tmux`; nothing else to migrate.

### Telegram bot can send pictures
- `telegram.botSendPhoto({ chatId, path, caption?, confirm: true })` sends one JPEG, PNG or WebP (up to 10 MB)
  with an optional caption. Same rules as `botSendMessage`: only chats listed in `telegram.botAllowedChatIds`,
  only with `confirm: true`, no retries.

### Background jobs are easier for agents to find and use
- System prompt names every call in full (`ctx.fns.agent.wake/cron/watch`, `jobs.list/cancel`), explains that
  commands and triggers are rows of one jobs table, lists watch predicate options, and says that cancel is
  silent.
- `wake`, `cron` and `watch` return a `hint` with how to list and cancel; the bash background result points
  to `jobs.list`. A command with no output now says "Output: none".

### Background eval runs as its own process
- `eval({ code, background })` now starts a bun process like a background bash job instead of a promise inside
  the server: `jobs.cancel` kills it, a server restart does not lose it, and a heavy loop no longer slows the
  server. Its `ctx.fns` calls go over `POST /jobs/eval` with the agent's session; `agent` is a snapshot and
  `ctx.state` is not available there. Type and parse errors fail the call before a job starts.

### One way for each thing (jobs)
- Background work and wake-ups have one call each: `bash/eval({ background })`, `agent.wake`, `agent.cron`,
  `agent.watch`, `agent.attach`; one list `jobs.list`, one stop `jobs.cancel({ id })` for every kind; output
  through `jobs.logs`. The guide is `docs/jobs.md` (agent-triggers, wake-ups and trigger-results docs merged in).
- `bash({ command, timeout, background: { afterMs: 30000, wake: "…" } })` waits up to `afterMs`: a command done
  by then returns its normal result; one still running keeps running as a job and wakes the agent with `wake`.
  `timeout` kills, `afterMs` only stops blocking.
- `eval({ code, background: true | { afterMs, wake } })` runs long in-process code as a job with the same
  completion message (runs inside the server: a restart reports it lost).
- Removed duplicates: `agent.wakeAt`, `agent.wakeIn`, `agent.wakeUpWhen`, `agent.cancelWake`,
  `agent.listSchedules`, `agent.triggers`, `agent.cancelTrigger`, `agent.cancelAllTriggers`, `agent.detach`,
  `agent.attachments` (→ `jobs.list` / `jobs.cancel`); `remote.start/logs/stop/jobs` (→ `bash({ host,
  background })`); the `sleep` timer runner (→ `agent.wake`); bash `notify` (→ `background.wake`); `jobs.wait`;
  the routes `POST /agent/:id/wake` and `/agent/:id/schedules` (the Automation panel uses `/agent/:id/triggers`).

### Jobs: background commands, timers and triggers in one table
- `bash({ background: true })` / `jobs.start` run a command in tmux (locally or over SSH) that survives a Hyper
  restart; the agent gets one message with exit code, duration and output tail when it ends. `jobs.list`,
  `jobs.get`, `jobs.logs` (secrets masked), `jobs.cancel` (silent). A "to background" button moves a running
  bash call into a job. Jobs that end within 2 s arrive in one turn.
- Wake-ups (`agent.wake`), cron (`agent.cron`), watches (`agent.watch`), usage-limit parking and external
  subscriptions (`agent.attach`) are rows of the same `jobs` table, with firings audited in `job_runs`.
  Archiving an agent cancels its jobs; stopping a turn does not.
- Every runtime message to an agent (job end, trigger, watch, attachment, team update) goes through
  `agent.deliver`: message, state and wake-up commit in one transaction, so none is lost or doubled.
- Upgrade: migrations run at boot, copy rows from `agent_triggers`, `agent_trigger_runs`, `agent_watches`,
  `agent_attachments` and `agents.wake_at` into `jobs` and drop the old tables. Nothing to do by hand.
  (Fixed after the first cut: on Postgres 18 the copy failed the boot on prompts with Cyrillic text.)
  Code that read those tables directly must use `jobs.list` / `agent.triggers`. Docs: `docs/jobs.md`.
