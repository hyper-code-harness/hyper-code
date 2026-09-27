# Eval typechecking with tsgo

Every eval is typechecked against the project before it runs
(`repl.typecheckEval`, on by default). That check used to run in-process: the
TypeScript Language Service lives on the event loop and checks synchronously,
so each eval stalled **every** agent stream and HTTP request.

Measured on this project (1219 files), main-thread stall per eval:

| | check | event-loop stall |
|---|---|---|
| in-process TS 5.9, first check | ~700 ms | ~780 ms |
| in-process TS 5.9, warm | 65–115 ms | 100–190 ms |
| Worker thread + TS 5.9, warm (prototype) | 70–100 ms | ~1 ms |
| **tsgo `--lsp --stdio`, warm** | **2–6 ms** | **~1 ms** |

## How it works

`src/tsgo/` keeps one `tsgo --lsp --stdio` child process (TypeScript 7 native,
`@typescript/native-preview`) per server:

- `tsgo.server({})` — spawns it in the project root, does the LSP handshake,
  watches `src/` and `script/` with `fs.watch`; changed files are sent as
  `workspace/didChangeWatchedFiles` before the next check (tsgo does not watch
  the disk itself under `--stdio`).
- `tsgo.check({ code, bindings })` — wraps the eval body exactly like the REPL
  does, updates one virtual document `src/__hyper_virtual_eval__.ts` (never
  written to disk; it must sit under `src/` to see the project's types), pulls
  `textDocument/diagnostic`, keeps error severity only (parse errors alone
  when the code does not parse). Checks are serialized.
- `tsgo.status({})` — enabled/installed/running, pid, RSS, check stats,
  fallbacks, last error.
- `$start` warms it in the background at boot; `$stop` shuts it down.

`procs.repl.typecheck` tries tsgo first and falls back to the in-process
service when tsgo is disabled (`tsgo.enabled` / `TSGO_TYPECHECK=false`), not
installed, crashed, or timed out. A killed tsgo restarts on the next check;
three crashes within a minute keep it off until `tsgo.server({ restart: true })`.

Cost: one extra process, ~330–450 MB RSS.
