#!/usr/bin/env bun
/** Offline preparation only: print read-only SQL, or generate a guarded reset SQL artifact.
 * Never connects to Postgres. Run with --help for the required backup manifest.
 */
import { createHash } from "node:crypto";
import { resolve, isAbsolute } from "node:path";

const args = process.argv.slice(2);
const usage = `Usage:
  bun maintenance/reset-agent-scratchpad/prepare.ts --dry-run
  bun maintenance/reset-agent-scratchpad/prepare.ts --prepare-apply /absolute/manifest.json
Manifest: { database, backupPath, sha256, runtimeStopped: true }
backupPath must be an absolute regular file (full database backup); sha256 is its SHA-256.
This prints SQL only. It never stops the server, changes connection settings, or executes SQL.
`;
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
try {
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage);
    } else if (args.length === 1 && args[0] === "--dry-run") {
        console.log(`\\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database() AS database, count(*) AS agents,
       count(*) FILTER (WHERE scratchpad IS DISTINCT FROM '{}') AS to_reset,
       coalesce(sum(octet_length(scratchpad)), 0) AS scratchpad_bytes
FROM public.agents;
SELECT datallowconn FROM pg_database WHERE datname = current_database();
SELECT pid, backend_type, state, application_name FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();
SELECT gid FROM pg_prepared_xacts WHERE database = current_database();
SELECT to_regclass('public.agent_scratchpad_reset_receipt') AS receipt_table;
COMMIT;`);
    } else if (args.length === 2 && args[0] === "--prepare-apply") {
        const manifestPath = resolve(args[1]);
        const manifest = await Bun.file(manifestPath).json();
        if (typeof manifest.database !== "string" || !manifest.database.trim()) throw new Error("database is required");
        if (typeof manifest.backupPath !== "string" || !isAbsolute(manifest.backupPath)) throw new Error("absolute backupPath is required");
        if (!/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("lowercase SHA-256 is required");
        if (manifest.runtimeStopped !== true) throw new Error("runtimeStopped attestation is required; stop all runtime/supervisor processes first");
        const stat = await (await import("node:fs/promises")).stat(manifest.backupPath);
        if (!stat.isFile() || stat.size === 0) throw new Error("backup must be a nonempty regular file");
        const hash = createHash("sha256");
        for await (const chunk of Bun.file(manifest.backupPath).stream()) hash.update(chunk);
        if (hash.digest("hex") !== manifest.sha256) throw new Error("backup SHA-256 mismatch");
        // Data values stay in SQL literals, never identifiers or DO dollar-quoted bodies.
        console.log(`\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
CREATE TEMP TABLE scratchpad_reset_input (database_name text, backup_path text, backup_sha256 text, manifest_path text) ON COMMIT DROP;
INSERT INTO scratchpad_reset_input VALUES (${quote(manifest.database)}, ${quote(manifest.backupPath)}, ${quote(manifest.sha256)}, ${quote(manifestPath)});
DO $reset$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Maintenance superuser required for complete connection visibility';
  END IF;
  IF current_database() <> (SELECT database_name FROM scratchpad_reset_input) THEN
    RAISE EXCEPTION 'Backup manifest database mismatch';
  END IF;
  IF (SELECT datallowconn FROM pg_database WHERE datname = current_database()) THEN
    RAISE EXCEPTION 'Database still allows connections: offline gate is not established';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) THEN
    RAISE EXCEPTION 'Other database sessions exist; no sessions will be terminated automatically';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database = current_database()) THEN
    RAISE EXCEPTION 'Prepared transactions exist';
  END IF;
END
$reset$;
LOCK TABLE public.agents IN ACCESS EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS public.agent_scratchpad_reset_receipt (
  reset_id text PRIMARY KEY, applied_at timestamptz NOT NULL,
  database_name text NOT NULL, backup_path text NOT NULL, backup_sha256 text NOT NULL,
  manifest_path text NOT NULL, affected_agents bigint NOT NULL
);
-- Primary key rejects a second reset, before touching any agent.
INSERT INTO public.agent_scratchpad_reset_receipt
SELECT 'clear-entire-scratchpad-v1', clock_timestamp(), database_name,
       backup_path, backup_sha256, manifest_path, (SELECT count(*) FROM public.agents)
FROM scratchpad_reset_input;
UPDATE public.agents SET scratchpad = '{}';
SELECT reset_id, affected_agents, applied_at FROM public.agent_scratchpad_reset_receipt
WHERE reset_id = 'clear-entire-scratchpad-v1';
COMMIT;
-- Connection gate intentionally remains closed. Follow the recovery/restart runbook.
`);
    } else {
        throw new Error(usage);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
