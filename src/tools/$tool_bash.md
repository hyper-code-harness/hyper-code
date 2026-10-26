---
description: >-
  Run a shell command via `bash -c`. Runs in the agent's workspace unless cwd says otherwise.
  Returns stdout; a non-zero exit returns [exit N] with stderr, and a command that outruns
  timeout is killed and reported with whatever it printed. Output is cut to its LAST 300 lines;
  filter it (grep, head, sed -n) rather than printing whole files or logs.
marker: bash
outputLimits:
  retain: tail
  maxLines: 300
promptSnippet: "run shell commands (ls, git, tests)"
promptGuidelines:
  - "To work on another machine pass host (an alias from ~/.ssh/config) to bash, read, write or edit; the connection is kept open between calls."
  - "Give bash a generous timeout when a command could hang (a server, a watcher, a prompt)."
  - "Anything over a minute or two (builds, full test suites, deploys) → background: true, or background: { afterMs: 30000 } when it may finish quickly. You get ONE message when the job ends — end your turn, do not poll. jobs.logs / jobs.cancel / jobs.list({ id })."
  - "Search with `rg -n pattern` (contents) and `rg --files -g glob` (names); never `find ~`."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})), or \"local\". Omit to run in the agent workspace — local, or remote when the workspace has a host (then cwd defaults to the workspace dir). Remote commands run via bash -lc over a persistent connection."
    command:
      type: string
      description: "Shell script to run."
    cwd:
      type: string
      description: "Directory to run in. Relative paths resolve against the workspace. Defaults to the workspace."
    env:
      type: object
      description: "Extra environment variables, merged over the server's own environment."
      additionalProperties:
        type: string
    secrets:
      type: object
      description: "Secret environment variables. Values must be op://, env:// or secret://namespace/name references (the latter written by secrets.set or secureInput.prompt({ saveAs })); resolved values are redacted from output."
      additionalProperties:
        type: string
    timeout:
      type: integer
      description: "Seconds before the command is killed. No timeout by default; with background: true the default is 24 h."
    background:
      type: [boolean, object]
      description: "Run as a background job: true returns a job id immediately, the command runs in tmux (local or host) and survives a Hyper restart; when it exits you receive one message with exit code, duration and output tail. Do not wait or poll for it — end your turn. An object { afterMs, wake } first waits afterMs: a command done by then returns its normal result; one still running keeps running as the job and you get `wake` with its completion."
      properties:
        afterMs:
          type: integer
          description: "Wait this long (ms, up to 600000) before returning the job id; 0 = background at once. Not a timeout: the command is never killed at afterMs."
        wake:
          type: string
          description: "Instruction included in the completion message, e.g. \"Tests finished. Inspect failures and fix them.\""
      additionalProperties: false
  required: [command]
  additionalProperties: false
---
### `§bash`

- Runs the body as a shell script via `bash -c`, in the workspace directory.
- `secrets` maps environment variable names to `op://`, `env://` or `secret://namespace/name` references. Values are injected only into the child process and redacted from captured output. A `secret://` entry is created with `secureInput.prompt({ title, saveAs: "secret://ns/name" })` (the human types it, the model only sees the reference) or `secrets.set({ ref, value })`.
- stdout comes back as the result; a non-zero exit returns `[exit N]` with stderr.

Example:

```ts
await ctx.fns.tools.bash({
  command: 'curl -H "Authorization: Bearer $TOKEN" https://api.example.com/me',
  secrets: { TOKEN: 'op://vault/item/field' },
  timeout: 30,
});
```

The model-visible command contains only `$TOKEN` and the secret reference. The resolved value exists in the child process environment and occurrences in captured stdout/stderr are replaced with `[REDACTED]`. `secrets` overrides variables with the same name from `env`.

This prevents accidental transcript leakage, not malicious exfiltration: the invoked program can still read the environment and send it over the network. Do not use `set -x`, place secret values in command arguments, or print the environment.
- `background` is the one way to run something longer than a tool call should block (builds, test suites, deploys, servers, downloads) — locally or with `host`:
  - `background: true` returns a job id at once. The command runs detached (output in `~/.hyper-jobs/<id>/out.log`) and survives a Hyper restart. When it exits you get one `job` message: exit code, duration, last ~4 KB of output. Jobs ending within ~2 s of each other arrive in one turn. If the process disappears (machine reboot) the job is reported as `lost`.
  - `background: { afterMs: 30000, wake: "…" }` waits up to `afterMs` first: a command that finishes in time returns its normal result (no job message); one still running returns `Still running after 30s — moved to background job <id>`, keeps running (same process) and its completion message carries `wake`. `timeout` still kills the process; `afterMs` only stops blocking you.
  - Then: `ctx.fns.jobs.logs({ id })` reads the output, `ctx.fns.jobs.cancel({ id })` stops it (silently — no message), `ctx.fns.jobs.list({})` shows everything running. Do not sleep or poll: end your turn.
- The marker form takes no options — use the `bash` tool call for cwd / env / secrets / timeout.
