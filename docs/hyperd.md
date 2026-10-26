# hyperd — process supervisor

hyperd keeps processes running for you and for agents: databases, dev servers, background commands, terminal
sessions. Every process runs under its own small holder, so restarting hyper (or hyperd) does not kill it.
State is in files under `~/.hyper/run/hyperd/` (hyperd may be what starts the database).

## Install

hyperd needs only Bun (≥ 1.3, for PTY) and this checkout. It must be started by the OS, not by hyper,
otherwise it dies with hyper and your services with it.

```bash
bun hyperd/cli.ts install                 # prints the service file for this machine and the commands
bun hyperd/cli.ts install --out /tmp/hd   # writes it to /tmp/hd/com.hyper.<user>-hyperd.plist (or hyperd.service)
```

Targets (`--target`): `launchd-system` (macOS default: `/Library/LaunchDaemons`, runs as your user via
`UserName`, works without a GUI login — needs sudo once), `launchd-user` (`~/Library/LaunchAgents`, only
with a GUI login session), `systemd-user` (Linux default, plus `loginctl enable-linger`), `systemd-system`.
The file uses the bun on PATH, this checkout and your HOME; `install` never runs sudo itself.

One hyperd per user, so the service name says whose it is (the scheme of `com.hyper.<user>`,
`com.hyper.<user>-pf`): launchd label `com.hyper.<user>-hyperd` (both launchd targets), systemd system unit
`hyperd-<user>`, systemd user unit `hyperd` (it already lives in that user's namespace). Several users on
one Mac each get their own daemon, socket and units, and installing one never replaces another's.

macOS, as an administrator, from the directory with the written plist (here for user `ann`):

```bash
sudo install -m 644 -o root -g wheel com.hyper.ann-hyperd.plist /Library/LaunchDaemons/com.hyper.ann-hyperd.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.hyper.ann-hyperd.plist
```

A daemon installed before this scheme runs as `com.hyper.hyperd`: `sudo launchctl bootout system/com.hyper.hyperd`,
remove its plist, install the new one — services keep running and the new daemon adopts them.

Linux (user service):

```bash
mkdir -p ~/.config/systemd/user && install -m 644 hyperd.service ~/.config/systemd/user/
loginctl enable-linger $USER && systemctl --user daemon-reload && systemctl --user enable --now hyperd
```

Check, then point hyper at it:

```bash
bun hyperd/cli.ts doctor      # daemon answers, parent is launchd/systemd, unit files valid, a PTY run works
```

In hyper set `jobs.backend` to `hyperd` (Settings, or `settings.set({ module: "jobs", scopeType: "global",
key: "backend", value: "hyperd" })`). Without an installed service hyper starts hyperd itself on first use
(`hyperd.ensure`) — fine for trying it out, not for production. If such a daemon is still running when you
install the service, the service-started copy waits until it exits; stop it with
`kill $(cat ~/.hyper/run/hyperd/hyperd.pid)` (your services keep running and are adopted).

Upgrade: `git pull`, then restart the daemon (`sudo launchctl kickstart -k system/com.hyper.<user>-hyperd` or
`systemctl --user restart hyperd`). Running services keep running: the new daemon adopts them.
Uninstall: the `uninstall` lines printed by `install`; units keep their files in `~/.hyper/units`.

## Services: write a unit file

`~/.hyper/units/<name>.yaml` (also `.json`, `.jsonc`, `.ts` with `export default { ... }`):

```yaml
kind: service                 # service = keep alive | task = run once | session = terminal
cmd: ["bun", "run", "dev"]    # argv, or a string run through bash -lc
cwd: ~/projects/web
env: { PORT: "3000" }         # values are strings — quote numbers
after: [pg-test]              # start once these are ready
ready: { http: "http://127.0.0.1:3000/health" }   # or tcp: 3000 | exec: [...] | log: "listening"
restart: { policy: on-failure, backoffMs: [1000, 30000], maxRestarts: 0 }
stop: { signal: SIGTERM, timeoutMs: 10000 }       # whole process group; SIGKILL after the timeout
logMatch: ["/error/i"]        # emit a log_match event for matching lines
ttlMs: 3600000                # optional: stop after this long
```

Then `hyperd.reload({})` (or `bun hyperd/cli.ts reload`). Unknown keys and wrong types are rejected with the
field name. A file named `web.yaml` is unit `web` unless it sets `name`.


## From an agent (ctx.fns.hyperd.*)

| Call | What it does |
|---|---|
| `status({})` | all units: state, pid, run, last exit |
| `reload({})` | reread unit files, start new services |
| `start / stop / restart({ name })` | control one unit |
| `run({ name, cmd, kind?, cwd?, env?, pty?, ttlMs?, logMatch? })` | transient unit without a file (like `systemd-run`); env is not stored |
| `logs({ name, offset?, limit? })` | output by byte offset; pass `next` to continue |
| `send({ name, data })` | input into a pty unit (`"\n"` = Enter) |
| `events({ after, waitMs? })` | event journal: started, ready, exited, restarting, gave_up, log_match … |

Background commands of agents (`bash({ background: true })`, `jobs.start`) run as hyperd task units named
after the job id when the setting `jobs.backend` is `hyperd` (local jobs only; SSH hosts use tmux). Use the
jobs functions for them, not hyperd directly.

States: `waiting` (for after) → `starting` (ready check) → `ready` → `stopping` → `exited` | `failed`;
`backoff` between restarts.

Good to know:

- `run({ env })` keeps env in hyperd's memory only, never on disk. A service restarted by hyperd itself gets it
  again; after a restart of hyperd the next run gets only the unit's own `env`.
- A `task` without a pty gets no stdin (EOF at once). Services and sessions keep stdin for `send`.
- When a process exits, whatever it left in its process group is killed.
- Finished transient units (background jobs) are removed with their logs a day after they ended (`HYPERD_GC_MS`).
- A ready check that never passes leaves the unit in `starting` and emits `unhealthy`; it is not restarted.
- Disk is bounded: a run's `out.log` rotates to `out.log.1` past 10 MB (`HYPERD_LOG_MAX_BYTES`), `events.ndjson`
  to `events.ndjson.1` past 5 MB (`HYPERD_EVENTS_MAX_BYTES`; `/events` reads across both), and each unit keeps
  its last 5 `run-<n>` directories (`HYPERD_KEEP_RUNS`). Logs by offset read the current `out.log` only.
- Not yet: Linux/systemd has unit tests but no live run so far.

## CLI

```
bun hyperd/cli.ts status | reload | start|stop|restart <u> | logs <u> [-f] [--offset N]
                  run <name> [--pty] -- <cmd...> | send <u> <text> | attach <u> | events [-f] [--after N]
                  install [--target T] [--out DIR] | doctor
```

`attach` connects your terminal to a pty unit; detach with Ctrl-\.

## Where things are

- code: `hyperd/` (main.ts daemon, holder.ts, Unit.ts, cli.ts, client.ts), hyper client `src/hyperd/`
- unit files: `~/.hyper/units/` (`HYPERD_UNITS`), state: `~/.hyper/run/hyperd/` (`HYPERD_HOME`)
- per unit: `units/<name>/spec.json`, `state.json`, `run-<n>/out.log`, `exit.json`, `pty.sock`
- OS service file: generated by `hyperd/service.ts` (`cli.ts install`); daemon log `~/.hyper/run/hyperd/daemon.log`
- design and plan: `docs/hyperd-design.md`
