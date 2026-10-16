# Trigger result references (prepared, not deployed)

Large predicate JSON (>16,000 UTF-16 units) is written to the existing immutable result store. `agent_trigger_runs.result` holds valid JSON with a bounded preview; additive `result_ref JSONB` holds the structured reference. Small results stay unchanged. False predicates are stored without delivering messages. On serialization or storage failure the run keeps a valid preview with `storageError`, no dangling reference, and the original readiness outcome.

Fired messages carry a preview and `result_ref`. `agent.readResult` accepts either a currently visible message reference (including existing fork boundaries), or a reference in the caller's own trigger run history. `resultStore.read` independently rechecks the exact reference and owner linkage before cache or pending-load access. Owner id alone grants nothing. The owner lookup uses `to_jsonb(r)->'result_ref'` so the pre-migration table remains readable; the tables themselves are already required by the existing trigger subsystem. Trigger listing exposes `lastResult` / `lastResultRef`; the audit popup shows preview and reference metadata.

## Rollout

No live migration, reload, restart, cleanup, commit or push was performed. Apply only `20330307120000_trigger_result_ref` after approval, then reload the affected agent functions and resultStore.read, and reload HTTP routes. Do not blindly run all pending migrations: other pending migrations may perform unrelated cleanup. No new runtime procedures were added. Existing function docs validations passed, but performed against the current live registry without loading these changes; source-level Bun tests exercise changed files.

## Crash limits

The existing sequence (delivery, trigger finalization, audit insert) is deliberately preserved. Storage failure does not lose a run, but process death between finalization and audit insertion can still lose audit history; death between delivery and finalization may duplicate notification on claim recovery. This patch does not promise exactly-once delivery or crash-atomic audit. Successful file writes interrupted before publication of a DB/message reference can leave an orphan immutable file; no deletion/GC is enabled.

## Verification

Targeted runner: 37 pass / 0 fail across watch, processTrigger, triggers, audit route, result storage and session result_ref tests. Covers false predicate, small values, serialization/storage failure, large JSON roundtrip, reference ownership/revocation on cache hits, existing foreign/fork authorization, persistence and audit rendering.

Full fast suite baseline: 1865 pass / 3 skip / 18 fail. After: 1875 pass / 3 skip / 14 fail. Additional observed full-suite failure was a timing-sensitive watch runtime.fn assertion (`completed` visible before audit insert); focused rerun passed. Other failures are baseline DB/schema, style tokens from unrelated changes, and code graph tests. Logs: `/tmp/trigger-baseline.log`, `/tmp/trigger-after.log`, `/tmp/trigger-target.log`. TypeScript was also run via Bun because the local Node binary has a missing llhttp dylib; no diagnostics for changed functions.
