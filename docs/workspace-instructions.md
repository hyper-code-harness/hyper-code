# Automatic workspace instructions

Hyper loads project guidance automatically before the first model request and after each completed tool batch. It does not depend on the model remembering to read a file. The implementation is in `workspaceInstructions`; `agent.run` calls `sync` at a safe request boundary, and `tools.call` records successful native read/write/edit paths through `touch`.

## Selection and precedence

- Global guidance: `~/.hyper/AGENTS.md`, then `~/.hyper/CLAUDE.md` on the workspace machine. These are optional files, separate from Hyper memory. Remote workspaces never receive the server's local global files as a fallback.
- Project guidance: nearest ancestor with a `.git` directory or worktree marker file, through the working directory, broad to specific. Without a marker, only the working directory is considered. No recursive tree search.
- Both `AGENTS.md` and `CLAUDE.md` load when different. Trimmed identical contents, including `AGENTS.md -> CLAUDE.md`, appear once per directory and global/project scope. Identical text in different scopes is not collapsed.
- Successful native `read`, `write`, and `edit` tools activate instruction directories on the path to the touched file below the workspace. At most 64 recently accessed file paths and 128 project directories are considered. Outside-workspace paths, other hosts, and nested symlink directories do not broaden discovery. Failures do not activate scopes.
- Only these two names are supported: not `AGENTS.override.md`, `*.local.md`, or arbitrary fallback names. Within a directory both distinct files apply in listed order; more specific instructions apply only inside their directory, not sibling scopes.
- File text is project guidance, not a system-policy override. Explicit user instructions and safety rules still take priority. It is never executed.

## Limits and failures

Each global/project chain has an independent **64 KiB UTF-8 content budget**. More specific files get space first; the final context remains ordered broad to specific. Duplicates cost no content bytes. Omitted/truncated sources remain visible, with warnings directing the agent to read the source explicitly before work in that scope. The source-file cap is 1 MiB; malformed UTF-8, changing files, nonregular files, and permission problems are reported without source text in logs. Instruction symlinks are accepted only when their canonical target stays inside the canonical directory of that instruction scope (or its descendants). Thus same-directory `AGENTS.md -> CLAUDE.md` works, while a link to an outside private file is omitted with a warning. Canonical paths are opened with nonblocking/no-follow flags, regular-file and identity checks; changed targets and FIFOs are rejected.

Discovery has bounded paths, warnings and serialized output (256 KiB), not just a content limit. Remote workspaces require **python3** and use one isolated (`python3 -I`) fixed-source SSH call, JSON input, and a 15-second command timeout. Missing Python, SSH failures, or invalid remote output produce an explicit warning and never fall back to local instructions. Local I/O is asynchronous, with a cooperative discovery deadline; an OS-stalled filesystem call itself cannot be forcibly cancelled.

## Context delivery and visibility

A changed snapshot is appended as a durable, cursor-excluded `world_state` user row, **not** inserted into the cached system/bootstrap prefix. It names the workspace, root, every source and its loaded/duplicate/omitted/truncated status. Each snapshot explicitly replaces all previous automatic workspace instructions. An empty selection revokes previous instructions. Errors do not silently retain a stale file body.

The loader checks before each provider request, so external file changes and deletions are picked up as well as edits performed by tools. Unchanged snapshots are not repeated. It uses the same effective context projection as the provider: after compaction removes the exact baseline, or a fork excludes it, the full current snapshot is delivered again. No row is inserted between a pending assistant tool call and its results.

The agent inspector's **Settings → Workspace instructions** section shows the last delivered source list and warnings, without file bodies. Switching workspace shows a pending check until the next request. Scratchpad stores only source metadata, digest, and bounded tracked paths. File bodies live only in the normal model-visible transcript.

## Deliberate boundaries

- `bash`, arbitrary `eval`, direct `files.*` calls and external editors do not register newly accessed nested file scopes. They still trigger a recheck of already selected instruction sources at the next request. An agent can use native `read` to activate a deeper scope or read its instructions explicitly.
- There is no background watcher and no repository migration or persistent file-content cache.
- Guidance is selected when a model request is prepared, not when an empty chat is created. An already-running session sees it on its next request.

## Tests

```sh
bun run test -- src/workspaceInstructions
bun run test:it -- src/workspaceInstructions
bun test ./src/agent/run.test.ts ./src/agent/goal.test.ts ./src/agent/syncWorldState.test.ts ./src/session/attachToTask.test.ts
```

Loader integration tests (`load.it.test.ts`, requires local `python3` and `mkfifo`) cover local and fixed-Python remote parity, roots, symlinks, deduplication, malformed files, bounded UTF-8 budgets and failures. Runtime tests (`sync.test.ts` and `run.test.ts`) cover real transcript ordering, nested native tools, workspace/host changes, removal, forks, compaction projection, empty-workspace silence and metadata visibility.
