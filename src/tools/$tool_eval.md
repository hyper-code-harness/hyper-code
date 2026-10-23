---
description: >-
  Run TypeScript/JavaScript inside the running server process. `ctx` is in scope, so every
  ctx.fns.<module>.<fn>({ ... }) is callable. The code is typechecked against the live project
  before execution when repl.typecheckEval is enabled. Jupyter-style — console.log/print are
  captured and the last expression is returned.
marker: eval
promptSnippet: "run JS/TS in-process, with ctx in scope"
promptGuidelines:
  - "Prefer ONE eval that composes several ctx.fns calls (loops, Promise.all) for mechanical work — reading N files, a series of selects. Keep DECISIONS (edits, commits, anything a human should see) as separate calls."
parameters:
  type: object
  properties:
    code:
      type: string
      description: "Code to evaluate. Top-level await is allowed."
    background:
      type: [boolean, object]
      description: "Run as a background job in its own process: true returns a job id at once and you get one message with the printed output when the code ends. An object { afterMs, wake } waits afterMs first: code done by then returns its normal result. Do not wait or poll — end your turn. ctx.fns calls work (over HTTP, as you); ctx.state and the live agent object do not — agent is a snapshot. jobs.cancel kills it."
      properties:
        afterMs:
          type: integer
          description: "Wait this long (ms, up to 600000) before returning the job id; 0 = background at once."
        wake:
          type: string
          description: "Instruction included in the completion message."
      additionalProperties: false
    timeout:
      type: integer
      description: "With background — seconds after which a still-running eval is reported as timeout (default 24 h)."
  required: [code]
  additionalProperties: false
---
### Native `eval` tool

- The JSON `code` argument runs as the body of an async function.
- By default it is checked by an in-process TypeScript Language Service before execution; type errors prevent all side effects.
- Disable globally with the declared setting `repl.typecheckEval=false` or `EVAL_TYPECHECK=false`. Internal callers may override one call with `procs.repl.eval({ code, typecheck: false })`.
- Top-level await works.
- Use `console.log(...)` or `print(...)` to produce output.
- Return values are ignored.
- `background: true` (or `{ afterMs, wake }`) turns a long eval — a crawl, a batch of LLM calls, a big import — into a job that runs as its own bun process, started like a background bash command: the call returns its id, printed output goes to the job log, and you get one `job` message when it ends (exit 0, or 1 with the stack when it threw). `jobs.logs`, `jobs.list` and `jobs.cancel` work as for bash jobs; cancel kills the process, and it survives a server restart.
- In that process every `ctx.fns.<ns>.<fn>(opts)` is an HTTP call to `POST /jobs/eval` with your agent's session (arguments and results must be JSON). `agent` is a snapshot (id, title, model, workspace); `ctx.state`, live objects and closures are not there. Typecheck and parse errors fail the call at once, before a job starts.
