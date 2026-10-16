# One-time offline reset of every agents.scratchpad (NOT executed)

This is a manual maintenance artifact, not a runtime procedure or `$migration_*` file.
`procs.migrate.up` automatically runs every pending scanned migration; a destructive
reset must never enter that list. `prepare.ts` only prints SQL and never connects
to a database. No runtime hot reload or migration registration is needed.

Scope: replace the entire **public.agents.scratchpad** text column with `'{}'`
for every row, including plans, history and flags. No JSON parsing (legacy values
may be invalid JSON). No messages/events/settings/queue columns are updated.
New plans can still be saved after restart. There is no online writer barrier:
`session.save` can overwrite the column from an old live object. Merely checking
`run_state`, pausing workers, or cancelling tasks does not prevent this.

## Safety boundary

The operator must stop **all runtime processes, workers, external writers and
supervisors/auto-restart services** on every machine using this DB, and verify
that no old process survives. Do not run this from a live agent tool. The SQL
checks superuser visibility, database identity, `datallowconn=false`, absence of
all other database sessions (including idle pools), and absence of prepared
transactions. ACCESS EXCLUSIVE protects the atomic reset. The database connection
gate blocks new connections while the sole maintenance connection operates.
No sessions are terminated automatically. A DBA concurrently changing the gate,
or privileged actors opening new gates, is outside this exclusive maintenance
protocol. Coordinate an exclusive maintenance window.

`runtimeStopped` is an operator attestation, **not automatic OS process detection**.
The database checks prove connection isolation at execution; they cannot prove
that a disconnected process holding old scratchpad data has exited. Process and
supervisor verification plus a fresh restart are mandatory, never optional.
The reset intentionally does not cancel durable scheduled work/queue rows: after
restart these load empty scratchpads; review queued work before reopening service.

## Read-only preview (can be prepared now)

```sh
bun maintenance/reset-agent-scratchpad/prepare.ts --dry-run > /safe/path/reset-preview.sql
```

Review/run this SQL via the normal approved database connection, never an implicit
localhost/default DB. It reports raw size/count and connections, without JSON casts.
If `receipt_table` is non-null inspect that table before proceeding. Preview is not
a snapshot approval: repeat after stopping writers.

## Execute LATER, after separate explicit approval

1. Confirm full-column/all-agent scope, maintenance window and backup location.
   Stop runtime + supervisors on all hosts, verify process lists/service state.
   Never stop the current runtime as part of preparing this artifact.
2. With writers stopped, take a **full database backup** plus a copy of the results
   directory. Record the exact target DB, absolute backup path and SHA-256. Verify
   the archive with the backup tool, and preferably test restoration in an isolated
   DB. A checksum alone does not prove restorability or database provenance; verify
   the dump's source DB with the backup operator/log and record it in the manifest.
   Earlier backups taken while writers were active are not a substitute for this
   final quiescent backup unless the exact recovery point was explicitly approved.
3. Open a dedicated privileged **maintenance psql session to the target DB first**.
   Verify `SELECT current_database(), pg_backend_pid();`. Keep this session open.
   Open a separate admin session to the **postgres database** for gate recovery.
   Use explicit host/port/user/database configuration; do not expose credentials.
4. From the admin session set the *verified, properly quoted target identifier*:
   `ALTER DATABASE "TARGET_DATABASE" WITH ALLOW_CONNECTIONS false;`
   Commit this setting; it is separate from the reset transaction. Do not close
   the already-open maintenance session. If other target sessions remain, stop
   their owning processes normally; do not kill sessions automatically. Resolve
   prepared transactions through their owners before proceeding.
5. Create a protected JSON manifest (no credentials):
   ```json
   {
     "database": "EXACT_TARGET_DATABASE",
     "backupPath": "/absolute/path/quiescent-full-database.dump",
     "sha256": "64-lowercase-hex-digits-from-verified-backup",
     "runtimeStopped": true
   }
   ```
   Generate the SQL on the machine containing the backup:
   ```sh
   bun maintenance/reset-agent-scratchpad/prepare.ts --prepare-apply /absolute/manifest.json > /safe/path/reset-apply.sql
   ```
   Check successful exit before using the output. It validates a nonempty regular
   backup file and recomputes its checksum. Do not modify the manifest/backup after
   generation. Protect the generated artifact; it contains paths, not backup bytes.
6. In the **existing** maintenance psql session: `\i /safe/path/reset-apply.sql`.
   Do not start a new psql connection to the gated target. The guarded transaction
   inserts the fixed `clear-entire-scratchpad-v1` primary-key receipt then updates
   all rows. A repeat fails before UPDATE. Receipt and reset commit together.
   The receipt lives outside scratchpad; it is not a row in `_migrations`.
7. Verify in that session:
   `SELECT count(*) FROM public.agents WHERE scratchpad IS DISTINCT FROM '{}';`
   must be zero, and inspect `public.agent_scratchpad_reset_receipt`. Do not erase
   the receipt to rerun. Check messages/events remain present against backup counts.
8. Restore `ALLOW_CONNECTIONS true` from the admin session only after ensuring
   **no old runtime process can reconnect**. Start a fresh runtime process (not
   hot reload/resume), then enable supervisors and other writers. Verify a new plan
   survives save/load and large results still read from files. Do not transplant
   old in-memory agent objects. Delayed promises died with the stopped processes.

## Failure / lost maintenance connection / rollback

- On SQL error: issue `ROLLBACK;` in the maintenance session. With `ON_ERROR_STOP`
  the rest of the artifact does not execute. Table/receipt/reset all roll back.
- The connection gate is intentionally **not** automatically reopened by the SQL.
  Whether reset failed, succeeded, or maintenance disconnected, the admin session
  connected to `postgres` can run:
  `ALTER DATABASE "TARGET_DATABASE" WITH ALLOW_CONNECTIONS true;`
  First verify all old runtime processes are still stopped. If maintenance was lost,
  use that admin connection to reopen the target, reestablish the maintenance
  connection, then close the gate again before retrying. Inspect the receipt to
  determine whether COMMIT happened; never assume connection loss means rollback.
- After a committed reset, rollback means an explicitly approved restore from the
  verified backup while offline, not deleting the marker or trying to recover from
  memory. Restoring a full DB may undo other changes; keep it a separate operation.

## Tests and limitations

```sh
bun run maintenance/reset-agent-scratchpad/prepare.test.ts
```

Run with `bun run`, not `bun test`: the standalone runner avoids the repository's
DB-backed preload. These are DB-free subprocess tests: fail-closed CLI, read-only preview, required
backup/checksum/stop attestation, string escaping and SQL guard/transaction order.
They **do not claim a PostgreSQL integration test** or exercise a real reset.
Before production execution, rehearse in a disposable database with a real dump:
normal gate-open refusal; wrong DB refusal; extra idle session refusal; duplicate
receipt refusal; malformed scratchpad reset; forced SQL error rollback; lost
connection recovery; and unchanged messages/queue fields. Never rehearse against
the live database. No production data, DB settings or processes were changed by
preparing or running the included tests.
