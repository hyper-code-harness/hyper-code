---
description: >-
  Run a shell command via `bash -c`. Runs in the agent's workspace unless cwd says otherwise.
  Returns stdout; a non-zero exit returns [exit N] with stderr, and a command that outruns
  timeout is killed and reported with whatever it printed.
marker: bash
promptSnippet: "run shell commands (ls, git, tests)"
promptGuidelines:
  - "To work on another machine pass host (an alias from ~/.ssh/config, list with ctx.fns.remote.servers({})) to bash, read, write or edit — no ssh quoting needed; the connection is kept open between calls."
  - "Give bash a timeout when a command could hang (a server, a watcher, a prompt) — and make it generous: a slow search needs minutes, and a timeout that is too tight kills work that was about to succeed."
  - "To locate files use the find tool and to search contents use grep; `bash find ~` walks every node_modules on the machine and dies on the clock."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "Remote SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})). Omit to act locally. With host, cwd is remote and the command runs via bash -lc over a persistent connection."
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
      description: "Seconds before the command is killed. No timeout by default."
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
- The marker form takes no options — use the `bash` tool call for cwd / env / secrets / timeout.
