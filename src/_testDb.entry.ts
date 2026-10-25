// The test database, made once. A suite used to migrate ~40 tables into a fresh pg_temp schema for EVERY test
// ctx (half a second each, most of a full run). Now:
//
//   template  hyper_test_t_<hash>   migrated once per migration set, on the test server (54399) — the hash is
//                                   taken over the core migration files, so editing one builds a new template
//   worker    hyper_test_w_<hash>_<pid>   CREATE DATABASE … TEMPLATE, once per test process; every ctx of the
//                                   process connects to it with an ordinary public search_path
//   reset     between tests (preload afterEach/afterAll): TRUNCATE what has rows, restart sequences, drop what a
//                                   test created on top of the template — back to the freshly migrated state
//
// `.entry.ts` keeps this out of the function scanner.
import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Snapshot = { tables: string[]; relations: Set<string>; schemas: Set<string>; migrations: string[] };
type Worker = { url: string; name: string; admin: SQL; snapshot: Snapshot; dirty: boolean };

const G = globalThis as any;
const workers: Map<string, Promise<Worker>> = (G.__hyperTestDbWorkers ??= new Map());

const EXTENSIONS = resolve(import.meta.dir, "../script/db-test/extensions.sql");

function withDb(url: string, db: string): string {
    const u = new URL(url);
    u.pathname = "/" + db;
    return u.toString();
}

function ident(name: string): string {
    return '"' + name.replaceAll('"', '""') + '"';
}

/**
 * The database URL of this process's private copy of the migrated template. Builds the template the first
 * time a migration set is seen (serialized across workers by an advisory lock).
 * @param baseUrl any URL on the test server; only host, port and credentials are used
 * @param hash identifies the migration set
 * @param migrate runs the core migrations against the URL it is given
 */
export async function workerDatabaseUrl(baseUrl: string, hash: string, migrate: (url: string) => Promise<void>): Promise<string> {
    const key = `${baseUrl}|${hash}`;
    let p = workers.get(key);
    if (!p) {
        p = openWorker(baseUrl, hash, migrate);
        workers.set(key, p);
        p.catch(() => workers.delete(key));
    }
    const w = await p;
    w.dirty = true;
    return w.url;
}

async function openWorker(baseUrl: string, hash: string, migrate: (url: string) => Promise<void>): Promise<Worker> {
    const template = `hyper_test_t_${hash}`;
    const name = `hyper_test_w_${hash}_${process.pid}`;
    const maint = new SQL(withDb(baseUrl, "postgres"), { max: 1, prepare: false });
    try {
        await maint.unsafe(`SELECT pg_advisory_lock(hashtext('hyper_test_template'))`);
        try {
            await dropStale(maint, template);
            const [has] = await maint.unsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, [template]);
            if (!has) await buildTemplate(maint, baseUrl, template, migrate);
            const [mine] = await maint.unsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]);
            // Same pid, same migrations: an earlier file of this process (bun --isolate gives each file a fresh
            // global) or a dead run whose pid came back. Either way the reset below makes it the template again.
            if (!mine) await maint.unsafe(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(template)}`);
        } finally {
            await maint.unsafe(`SELECT pg_advisory_unlock(hashtext('hyper_test_template'))`);
        }
    } finally {
        await maint.close();
    }
    const url = withDb(baseUrl, name);
    const admin = new SQL(url, { max: 1, prepare: false });
    (G.__hyperTestAdminPools ??= new Set()).add(admin);
    const snapshot = await snapshotOf(admin);
    const w: Worker = { url, name, admin, snapshot, dirty: true };
    await resetWorker(w);
    return w;
}

async function buildTemplate(maint: SQL, baseUrl: string, template: string, migrate: (url: string) => Promise<void>): Promise<void> {
    // Built under a temporary name and renamed when complete: a crash mid-way leaves no half-migrated template.
    const building = `${template}_build`;
    await maint.unsafe(`DROP DATABASE IF EXISTS ${ident(building)} WITH (FORCE)`);
    await maint.unsafe(`CREATE DATABASE ${ident(building)}`);
    const url = withDb(baseUrl, building);
    const sql = new SQL(url, { max: 1, prepare: false });
    try {
        await sql.unsafe(readFileSync(EXTENSIONS, "utf8"));
    } finally {
        await sql.close();
    }
    await migrate(url);
    await maint.unsafe(`ALTER DATABASE ${ident(building)} RENAME TO ${ident(template)}`);
}

// Worker copies of processes that are gone, and templates of migration sets nobody runs any more.
async function dropStale(maint: SQL, template: string): Promise<void> {
    const rows = await maint.unsafe(`SELECT datname FROM pg_database WHERE datname LIKE 'hyper\\_test\\_%'`);
    for (const { datname } of rows as { datname: string }[]) {
        const w = /^hyper_test_w_[0-9a-z]+_(\d+)$/.exec(datname);
        if (w) {
            if (!alive(Number(w[1]))) await maint.unsafe(`DROP DATABASE IF EXISTS ${ident(datname)} WITH (FORCE)`).catch(() => {});
            continue;
        }
        if (/^hyper_test_t_[0-9a-z]+$/.test(datname) && datname !== template) {
            // Still the template of a live run (its workers' copies exist)? Leave it.
            const hash = datname.slice("hyper_test_t_".length);
            const users = (rows as { datname: string }[]).filter(r => r.datname.startsWith(`hyper_test_w_${hash}_`)
                && alive(Number(r.datname.split("_").pop())));
            if (!users.length) await maint.unsafe(`DROP DATABASE IF EXISTS ${ident(datname)} WITH (FORCE)`).catch(() => {});
        }
    }
}

function alive(pid: number): boolean {
    if (!pid) return false;
    if (pid === process.pid) return true;
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

async function snapshotOf(admin: SQL): Promise<Snapshot> {
    // Ordinary tables of the migrations, not those an extension owns (postgis' spatial_ref_sys).
    const tables = (await admin.unsafe(`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
        ORDER BY 1`)).map((r: any) => r.relname as string);
    const relations = new Set<string>((await admin.unsafe(`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'`)).map((r: any) => r.relname as string));
    const schemas = new Set<string>((await admin.unsafe(`SELECT nspname FROM pg_namespace`)).map((r: any) => r.nspname as string));
    const migrations = (await admin.unsafe(`SELECT id FROM _migrations`)).map((r: any) => r.id as string);
    return { tables: tables.filter(t => t !== "_migrations"), relations, schemas, migrations };
}

/** Back to the migrated template in every worker database a test touched since the last reset. */
export async function resetTestDatabases(): Promise<void> {
    for (const p of workers.values()) {
        const w = await p.catch(() => null);
        if (w?.dirty) await resetWorker(w);
    }
}

async function resetWorker(w: Worker): Promise<void> {
    w.dirty = false;
    try {
        await resetOnce(w);
    } catch (error: any) {
        // ParadeDB starts a background merger for a bm25 index (functions_bm25) after the rows a test wrote; it
        // holds AccessShareLock on the table and then asks for its own catalog, while TRUNCATE … CASCADE holds one
        // and asks for the other: Postgres kills our TRUNCATE as a deadlock and the test that just passed fails.
        // The merger finishes in milliseconds; the second attempt goes through.
        if (/deadlock detected/i.test(String(error?.message))) {
            for (let attempt = 1; ; attempt++) {
                await Bun.sleep(50 * attempt);
                try { return await resetOnce(w); }
                catch (again: any) { if (attempt >= 5 || !/deadlock detected/i.test(String(again?.message))) throw again; }
            }
        }
        // A connection left idle inside a transaction (a test that never finished one) holds its locks forever;
        // those sessions belong to tests that are over.
        if (!/lock timeout|canceling statement/i.test(String(error?.message))) throw error;
        await w.admin.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [w.name]);
        await resetOnce(w);
    }
}

async function resetOnce(w: Worker): Promise<void> {
    const s = w.snapshot;
    const sql = w.admin;
    await sql.unsafe(`SET lock_timeout = '3s'`);
    // What a test created beyond the template: its own tables (db.test.ts makes `t`, `notes`), schemas.
    const extraSchemas = (await sql.unsafe(`SELECT nspname FROM pg_namespace`)).map((r: any) => r.nspname as string).filter((n: string) => !s.schemas.has(n));
    for (const n of extraSchemas) await sql.unsafe(`DROP SCHEMA IF EXISTS ${ident(n)} CASCADE`);
    const extra = (await sql.unsafe(`
        SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`)).filter((r: any) => !s.relations.has(r.relname));
    for (const r of extra as { relname: string; relkind: string }[]) {
        const kind = r.relkind === "v" ? "VIEW" : r.relkind === "m" ? "MATERIALIZED VIEW" : r.relkind === "S" ? "SEQUENCE" : r.relkind === "f" ? "FOREIGN TABLE" : "TABLE";
        await sql.unsafe(`DROP ${kind} IF EXISTS public.${ident(r.relname)} CASCADE`);
    }
    // Only the tables that hold rows: one round trip to find them, one TRUNCATE for all.
    const probe = s.tables.map(t => `SELECT ${sqlString(t)} AS t WHERE EXISTS (SELECT 1 FROM public.${ident(t)})`).join(" UNION ALL ");
    const full = probe ? (await sql.unsafe(probe)).map((r: any) => r.t as string) : [];
    if (full.length) await sql.unsafe(`TRUNCATE ${full.map(t => "public." + ident(t)).join(", ")} RESTART IDENTITY CASCADE`);
    // Sequences advanced by rows that were deleted, not truncated (ids start at 1 again, as on a fresh db).
    const seqs = await sql.unsafe(`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND last_value IS NOT NULL`);
    for (const r of seqs as { sequencename: string }[]) await sql.unsafe(`ALTER SEQUENCE public.${ident(r.sequencename)} RESTART`);
    // A test that applied a migration of its own: forget it, its tables were dropped above.
    if (s.migrations.length) await sql.unsafe(`DELETE FROM _migrations WHERE id NOT IN (${s.migrations.map(sqlString).join(", ")})`);
}

function sqlString(s: string): string {
    return "'" + s.replaceAll("'", "''") + "'";
}

/** Close the reset connections (end of a test process). */
export async function closeTestDatabases(): Promise<void> {
    const pools: Set<SQL> | undefined = G.__hyperTestAdminPools;
    if (!pools) return;
    for (const sql of [...pools]) {
        pools.delete(sql);
        try { await sql.close(); } catch { /* already closed */ }
    }
    workers.clear();
}
