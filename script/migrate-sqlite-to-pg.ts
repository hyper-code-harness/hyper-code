#!/usr/bin/env bun
// One-shot data migration: copy the pre-Postgres sqlite DB into the hyper
// Postgres. Idempotent (ON CONFLICT DO NOTHING). Run the pg migrations first
// (boot the server once, or bun script/repl.ts 'ctx.fns.procs.migrate.up({})').
//
//   bun script/migrate-sqlite-to-pg.ts [path-to-sqlite] [pg-url]
import { Database } from "bun:sqlite";
import { SQL } from "bun";

const sqlitePath = process.argv[2] ?? ".hyper/_runtime/sessions";
const pgUrl = process.argv[3] ?? process.env.DATABASE_URL;
if (!pgUrl) throw new Error("pass a Postgres URL or set DATABASE_URL");

const lite = new Database(sqlitePath, { readonly: true });
const pg = new SQL(pgUrl, { max: 4 });

async function copy(table: string, columns: string[], transform?: (row: any) => any) {
    const rows = lite.query(`SELECT ${columns.join(", ")} FROM ${table}`).all() as any[];
    let n = 0;
    for (const raw of rows) {
        const row = transform ? transform(raw) : raw;
        // pg text refuses NUL bytes; old sqlite transcripts contain a few.
        for (const k of Object.keys(row)) {
            if (typeof row[k] === "string" && row[k].includes("\u0000")) row[k] = row[k].replaceAll("\u0000", "");
        }
        const keys = Object.keys(row);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        await pg.unsafe(
            `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            keys.map(k => row[k]),
        );
        n++;
    }
    console.log(`${table}: ${n} rows`);
}

await copy("agents",
    ["id", "model", "system_prompt", "scratchpad", "created_at", "updated_at", "archived_at",
     "parent_id", "fork_offset", "last_processed_msg_idx"],
    // Land quiet: no pending runs, no stale locks carried over.
    (r) => ({ ...r, run_state: "idle", next_run_at: null, run_started_at: null, last_error: null }));
await copy("messages", ["agent_id", "idx", "role", "content", "ts", "excluded_from_llm", "excluded_from_cursor"]);
await copy("events", ["agent_id", "idx", "type", "payload", "ts"]);
await copy("settings", ["module", "scope_type", "scope_id", "key", "value", "is_secret", "updated_at"]);
await copy("kv", ["key", "value"]);

await pg.close();
lite.close();
console.log("done");
