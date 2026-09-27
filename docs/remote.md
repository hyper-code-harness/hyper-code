# Remote machines over SSH

Agents work on other machines with the same tools they use locally. Every file
and shell tool takes an optional `host` — an alias from `~/.ssh/config`:

```
read({ host: "laptop", path: "~/proj/a.ts", hashline: true })
edit({ host: "laptop", path: "~/proj/a.ts", edits: [...] })
grep({ host: "vibe-base", pattern: "TODO", path: "app" })
find({ host: "vibe-base", pattern: "*.sql", path: "migrations" })
bash({ host: "laptop", command: "bun test", cwd: "~/proj" })
write({ host: "laptop", path: "notes.md", content: "..." })
```

Without `host` nothing changes: the tool acts on the local workspace. With it,
paths are remote and relative ones resolve against the remote home.

## Transport

System OpenSSH, not an SSH library — so `~/.ssh/config`, keys, ssh-agent,
ProxyJump and Tailscale names just work. The first call to a host opens a
ControlMaster socket in `~/.ssh/hyper-cm/` kept for 30 minutes; every later
call (tools, `remote.*`, rsync) rides it: ~60 ms instead of ~250 ms+.
`remote.sshOptions` is the single source of those options; `remote.quote` and
`remote.shellPrelude` are the single source of quoting and the remote PATH.

- The script travels over **stdin**, framed by its length — commands and
  exported secrets never show up in the remote `ps`.
- Commands run in `bash -lc` with PATH extended by `~/.bun/bin`, `~/.local/bin`,
  `~/.cargo/bin`, Homebrew and `/usr/local/bin` (non-interactive shells skip
  `~/.zshrc`).
- A timeout kills the local ssh **and** the remote process tree.
- `edit` reads the file, applies the edit locally, writes it back with a
  compare-and-swap: if the file changed on the server in between, the write is
  refused (`expectedContent`).
- Remote `bash` output is capped at 100 KB (head + tail kept).
- Images: `read` on a remote `.png/.jpg/.gif/.webp` pulls it with rsync and
  returns the picture.

## `ctx.fns.remote.*`

| fn | what |
|----|------|
| `servers({})` | aliases from ssh config with resolved hostname/user/port |
| `exec({ host, command, cwd?, stdin?, timeout? })` | run bash; `{ stdout, stderr, exitCode, timedOut, ms }` |
| `readFile` / `writeFile` | whole text file; writeFile is atomic (temp + mv), optional `expectedContent` |
| `grep` / `find` | ripgrep on the host if present, else `grep -r` / `find`; vendored dirs skipped |
| `rsync({ host, direction: "push" \| "pull", local, remote, exclude?, delete?, dryRun? })` | incremental copy; works with GNU rsync and macOS openrsync |
| `status({ host })` | reachable?, OS, uptime, load, CPUs, memory, disk, listening ports |
| `start({ host, name, command, cwd?, env?, restart? })` | long-running job in tmux `hyper-<name>`, log in `~/.hyper-jobs/<name>.log` |
| `logs` / `stop` / `jobs` | tail (optional grep), Ctrl-C then kill, list |
| `close({ host? })` | drop the master connection; next call reconnects |
| `sshOptions({})` | shared ssh args for your own ssh/scp/rsync calls |
| `quote({ value, path? })` | bash-quote a value; with `path` a leading `~`/`~/` stays expandable |
| `shellPrelude({})` | the PATH prelude every remote command starts with |

Watch a job live: `ssh <host> -t tmux attach -t hyper-<name>`.

## Configuration

- `HYPER_SSH_CONFIG` — use this ssh_config instead of `~/.ssh/config` (passed as `-F`).
- `HYPER_SSH_CONTROL_DIR` — where master sockets live (default `~/.ssh/hyper-cm`).

## Tests

`src/remote/remote.test.ts` runs against two sshd containers from `test/ssh/`
(`plain`: no ripgrep → fallbacks; `rg`: with ripgrep). They are started on
first use and **stay running** (compose project `hyper-ssh-<hash of checkout>`),
so later runs connect in under a second; a change to the Dockerfile rebuilds
them. Each run resets the remote home. The throwaway key and a private
ssh_config live in `.test-tmp/ssh-fixture/`, and the ctx is pointed at them via
the two env vars above — the developer's `~/.ssh` is never touched. No Docker →
the suite is skipped. `HYPER_SSH_FIXTURE_DOWN=1` removes the containers after
the run. Run it by path: `bun test ./src/remote/`.

## Not yet

- default host per agent: `agent.workspaceHost` next to `workspaceDir` (when set,
  `workspaceDir` is a path on that host) — designed, not built
- binary `readFile`/`writeFile` (images go through rsync)
- permission tiers (read-only / write / sudo)
