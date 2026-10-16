# Trigger result references

Large predicate JSON (>16,000 UTF-16 units) is written to the existing immutable result store. `agent_trigger_runs.result` holds valid JSON with a bounded preview; additive `result_ref JSONB` holds the structured reference. Small results stay unchanged. False predicates are stored without delivering messages. Predicates are serialized once. Shared `resultStore.prepare` keeps a 2,500-unit preview on success and storage failure; serialization failure retains an explicit placeholder and `storageError`. Neither failure publishes a dangling reference or changes readiness.

Tool outputs use the same preparation helper but keep their own text semantics, 6,000-unit inline threshold, and bash tail previews. Trigger JSON retains its 16,000-unit threshold. Ref creation remains exclusively in `resultStore.write` after successful storage.

Fired messages carry preview and `result_ref`. `agent.readResult` delegates UUID resolution to `resultStore.read`, which performs one authoritative history lookup (plus owned trigger lookup if needed) before every cache or pending access. The compatible `ref` option additionally requires matching metadata; no caller-controlled authorization bypass exists. Visible fork history remains supported. Owner id alone grants nothing. The lookup uses `to_jsonb(r)->'result_ref'`; trigger tables are required. Trigger listing exposes `lastResult` / `lastResultRef`; audit UI shows preview and metadata.

## Rollout

The follow-up refactor was reviewed by the parent and hot-reloaded provider-first: `resultStore.prepare`, `resultStore.read`, then `agent.readResult`, `agent.stashResult`, `agent.processTrigger`. All five passed strict docs validation/typecheck. A pre-existing authorized stored result was successfully read through the live UUID API. No migration, restart, cleanup, commit or push was performed. No schema changes are needed by this refactor; initial installations still require the existing trigger result_ref migration. Never blindly run pending migrations.

## Crash limits

Delivery remains before finalization, outside the DB transaction. Trigger final UPDATE and run INSERT now commit together through `procs.db.transaction`: insert failure rolls back status, attempts and claim release. A stale claim (zero updated rows) inserts no run. Existing `ON CONFLICT DO NOTHING` behavior is preserved: an already recorded scheduled run is retained rather than overwritten.

Death after delivery but before commit can still duplicate notification during claim recovery. Delivery itself is not transactional here. This is not exactly-once delivery. Successful file writes interrupted before DB/message reference publication may leave orphan immutable files; no deletion/GC is enabled. No backup restore was tested. Unrelated untracked maintenance files were left untouched.

## Verification (follow-up after 63d3885)

Targeted: **44 pass / 0 fail**, seven files covering storage, tool stashing, processTrigger, isolated Postgres atomicity, watches, trigger API and session refs. Includes forced SQL CHECK failure with reselect proving rollback, successful retry, lost claim, one serialization, cold-cache reads, revoked warm-cache access and foreign trigger denial.

Fast suite baseline: **1875 pass / 3 skip / 14 fail**. After: **1880 pass / 3 skip / 13 fail**. Every remaining failure also existed in baseline; the relative Markdown Files failure did not recur. These are DB/schema/test-harness, style-token and callgraph/other baseline failures; the whole suite is not green. Logs: `/tmp/result-ref-baseline.log`, `/tmp/result-ref-after.log`, `/tmp/result-ref-target.log`. Runtime code quality reports ok with zero errors and 485 repository-wide warnings.
