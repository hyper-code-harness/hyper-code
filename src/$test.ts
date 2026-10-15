// Test harness — skipped by the scanner (stem "$test" is reserved), so it's
// never registered. Co-locate tests as src/<module>/<name>.test.ts and run
// `bun test` (or ctx.fns.procs.dev.test from the REPL). Each test gets a real ctx
// with the core registry loaded but NO installed plugins or server/watcher:
//
//   import { test, expect } from "bun:test";
//   import { testCtx } from "../$test";
//   const ctx = await testCtx();
//   test("fib", async () => {
//     expect(await ctx.fns.math.fib({ n: 10 })).toEqual({ n: 10, fib: 55 });
//   });
import { resolve } from "node:path";
import { makeCtx, makeRequestCtx } from "./$main";
import loadFns from "./procs/boot/load";
import loadMigrations from "./procs/migrate/$loader_migration";
import { readFileSync } from "node:fs";
import { workerDatabaseUrl, resetTestDatabases } from "./_testDb.entry";

// Fresh ctx per call → test files don't leak ctx.state into each other.
// Registry + routes loaded (so ctx.fns.procs.http.dispatch can match), NODE_ENV=test, and NO server is started.
//
// Loaded ONCE per test process: the first ctx of the default tree boots it (imports ~2000 files, 0.1–1 s), every
// later ctx gets a copy of that state — plain objects, arrays, Maps and Sets copied, functions and class instances
// shared — so a test that stubs ctx.state.registry.x.y or adds a route changes only its own ctx. A ctx with its own
// root, workdir or plugin roots still boots from scratch.
//
// Database: one migrated template on the test server, one copy per test process (see _testDb.entry.ts); every ctx
// connects to that copy. It is reset to the migrated state after each test that made its own ctx, and when a new
// test file makes its first ctx — so a test sees an empty database, and a file's shared ctx (top level, beforeAll)
// keeps its data across that file's tests. opts.env.DATABASE_URL pins a database of the caller's instead, migrated
// in place.
export async function testCtx(opts?: { root?: string; workdir?: string; env?: Record<string, string> }): Promise<Context> {
    await beginFileIfNew();
    const ctx = makeCtx();
    const defaultRoot = resolve(import.meta.dir, "..");
    // Default root = THIS repo (this file lives in src/). Without it projectRoot
    // falls back to src/procs/../.. = src, and genTypes/discover look in src/src.
    ctx.state.root = opts?.root ?? defaultRoot;
    // Per-ctx, never through process.env: two test files that each need their own
    // project would otherwise fight over one global, and the loser mounts the
    // wrong thing (this is exactly what happened).
    if (opts?.workdir) ctx.env.WORKDIR = opts.workdir;
    // Never inherit installed plugins from the developer's environment or the
    // host manifest. Tests of plugin discovery may explicitly opt into disposable fixtures via
    // opts.env; those fixtures must not migrate persistent/qualified schemas.
    ctx.env.USER_PLUGINS = "";
    ctx.env.PROCS_PLUGINS = "";
    // Tests never touch the working database: they go to the test Postgres (hyper-db-test, port 54399 in
    // docker-compose.yml) — TEST_DATABASE_URL, or DATABASE_URL with that port. A suite on the live server used
    // to fill its lock table and fail every query of the running agents (15.10). opts.env may still pin a URL.
    if (ctx.env.DATABASE_URL || ctx.env.TEST_DATABASE_URL) ctx.env.DATABASE_URL = testDatabaseUrl(ctx.env);
    Object.assign(ctx.env, opts?.env ?? {});
    ctx.env.NODE_ENV = "test";
    // Boot chatter is `log.debug` and the default level is info, so a test run is
    // quiet without anyone muzzling console.log. LOG_LEVEL=debug shows it all.
    ctx.env.LOG_LEVEL ??= "warn";
    const pinnedDb = !!opts?.env?.DATABASE_URL;

    const shareable = ctx.state.root === defaultRoot && !opts?.workdir
        && !opts?.env?.USER_PLUGINS && !opts?.env?.PROCS_PLUGINS && opts?.env?.PROCS_PATH === undefined;
    const G = globalThis as any;
    if (shareable && G.__hyperTestBoot) {
        ctx.state = copyState(G.__hyperTestBoot);
    } else {
        await loadFns(ctx, null, {});
        await ctx.fns.procs.http.loadRoutes({});
        // Workspace declarations and .hyper overlays can also mount plugins even
        // when the environment roots above are disabled. Never run their migrations
        // on the test database. Rebuild from this harness's trusted src tree (not
        // IDs: an external migration could collide with a core migration ID).
        const coreSrc = resolve(import.meta.dir);
        const entries = await ctx.fns.procs.project.scan({});
        const coreMigrations = entries.filter(entry => entry.kind === "migration" && entry.rootDir === coreSrc);
        ctx.state.procs.migrate.list = [];
        await loadMigrations(ctx, null, { entries: coreMigrations });
        if (shareable) G.__hyperTestBoot = copyState(ctx.state);
    }

    if (pinnedDb) {
        await ctx.fns.procs.migrate.up({});
    } else {
        ctx.env.DATABASE_URL = await workerDatabaseUrl(String(ctx.env.DATABASE_URL), migrationHash(ctx), async (url) => {
            const builder: any = Object.create(ctx);
            builder.env = { ...ctx.env, DATABASE_URL: url };
            builder.state = { ...ctx.state, procs: { ...ctx.state.procs, db: {} } };
            try { await builder.fns.procs.migrate.up({}); } finally { await builder.fns.procs.db.close({}); }
        });
    }
    trackTestCtx(ctx);
    return ctx;
}

// The migration set the template was built from: ids plus the text of their files.
function migrationHash(ctx: Context): string {
    const G = globalThis as any;
    if (G.__hyperTestMigrationHash) return G.__hyperTestMigrationHash;
    const list = [...((ctx.state as any).procs?.migrate?.list ?? [])].map((m: any) => m.id).sort();
    const entries = ((ctx.state as any).procs?.boot?.entries ?? []).filter((e: any) => e.kind === "migration" && e.rootDir === resolve(import.meta.dir));
    const texts = entries.map((e: any) => e.abs).sort().map((abs: string) => readFileSync(abs, "utf8"));
    texts.push(readFileSync(resolve(import.meta.dir, "../script/db-test/extensions.sql"), "utf8"));
    return (G.__hyperTestMigrationHash = Bun.hash(list.join("\n") + "\0" + texts.join("\0")).toString(36));
}

// A copy of booted state for one ctx: containers copied (so stubbing a registry slot or adding a route stays in
// this ctx), leaves shared (functions, class instances — they are the loaded code, not data).
function copyState(v: any, seen = new Map<any, any>()): any {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) { const out: any[] = []; seen.set(v, out); for (const x of v) out.push(copyState(x, seen)); return out; }
    if (v instanceof Map) { const out = new Map(); seen.set(v, out); for (const [k, x] of v) out.set(k, copyState(x, seen)); return out; }
    if (v instanceof Set) { const out = new Set(); seen.set(v, out); for (const x of v) out.add(copyState(x, seen)); return out; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;
    const out: any = proto === null ? Object.create(null) : {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = copyState(v[k], seen);
    return out;
}

// Which ctxs belong to the running test (closed and reset after it) and which to the file (closed and reset when
// the next file makes its first ctx). The preload's afterEach calls endTest.
function trackTestCtx(ctx: Context): void {
    const G = globalThis as any;
    const t = (G.__hyperTestCtxs ??= { file: "", fileCtxs: [] as Context[], testCtxs: [] as Context[] });
    if (G.__hyperInTest) t.testCtxs.push(ctx); else t.fileCtxs.push(ctx);
}

/** Before a file's first ctx: close the previous file's ctxs and reset the database. */
export async function beginFileIfNew(): Promise<void> {
    const G = globalThis as any;
    const t = (G.__hyperTestCtxs ??= { file: "", fileCtxs: [] as Context[], testCtxs: [] as Context[] });
    if (t.file === Bun.main) return;
    t.file = Bun.main;
    const old = [...t.fileCtxs, ...t.testCtxs];
    t.fileCtxs = []; t.testCtxs = [];
    for (const c of old) await (c as any).fns.procs.db.close({}).catch(() => {});
    await resetTestDatabases();
}

/** After a test: close the ctxs it made and reset the database if it made any. */
export async function endTest(): Promise<void> {
    const G = globalThis as any;
    const t = G.__hyperTestCtxs;
    if (!t?.testCtxs.length) return;
    const mine = t.testCtxs;
    t.testCtxs = [];
    for (const c of mine) await (c as any).fns.procs.db.close({}).catch(() => {});
    await resetTestDatabases();
}

// Request-scoped ctx + session, for testing route handlers / things that read
// the session (params, req). Anything it calls via ctx.fns.* sees this session.
export function reqCtx(ctx: Context, opts?: { params?: Record<string, string>; req?: Request }): Context {
    return makeRequestCtx(ctx, { kind: "test", params: opts?.params ?? {}, req: opts?.req });
}

// The test Postgres URL: TEST_DATABASE_URL, else DATABASE_URL moved to the test server's port (54399).
// Refuses the working port, so a missing test server fails loudly instead of quietly loading the live one.
export function testDatabaseUrl(env: Record<string, string | undefined>): string {
    const explicit = env.TEST_DATABASE_URL;
    const url = new URL(explicit || String(env.DATABASE_URL));
    if (!explicit) url.port = "54399";
    if (url.port === "54393") throw new Error("tests must not run on the working database (port 54393); set TEST_DATABASE_URL");
    return url.toString();
}
