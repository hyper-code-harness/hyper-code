// Safe switch of an existing Hyper database to users (DESIGN §34–§36).
//
//   bun script/multiuser.ts plan      --name "…" --email a@b [--email2 c@d]   # read-only preflight
//   bun script/multiuser.ts backup                                            # pg_dump of the affected tables
//   bun script/multiuser.ts up        --name "…" --email a@b [--attribute]    # migrate + first user
//   bun script/multiuser.ts verify                                            # post-checks
//   bun script/multiuser.ts down      [--yes]                                 # remove users + author columns
//
// DATABASE_URL selects the database (default: package.json procs.prod procs/db.url). Run `plan`
// against a copy first. Nothing here touches plugin schemas: only public.users and three
// nullable columns on agents/messages/events.
import { bootRegistry } from "../src/$main";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "plan";
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string) => argv.includes(`--${name}`);
const MIGRATION = "20320401000000_users";

// Never load user plugins: their migrations target real schemas (see src/$test.ts).
process.env.USER_PLUGINS = "";
process.env.PROCS_PLUGINS = "";
const ctx: any = await bootRegistry();
ctx.env.USER_PLUGINS = "";
ctx.env.PROCS_PLUGINS = "";
const db = ctx.fns.procs.db;
const one = async (sql: string, params: unknown[] = []) => ((await db.select({ sql, params })) as any[])[0];
const url = String(ctx.fns.procs.db.url());
const safeUrl = url.replace(/\/\/([^:@]+):[^@]*@/, "//$1:***@");
const out = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
const fail = (msg: string): never => { console.error("✗ " + msg); process.exit(1); };
console.error(`database: ${safeUrl}`);
// Writing commands must name the database explicitly, so a copy is never confused with the live one.
if (["up", "down"].includes(cmd)) {
    const dbName = new URL(url).pathname.replace(/^\//, "");
    if (flag("db") !== dbName) fail(`refusing to write: pass --db ${dbName} to confirm the target database`);
}

// The exact shape the code expects. A pre-existing table of another shape must be converged by the
// migration, never silently accepted (an early draft left NOT NULL email/password behind once).
async function schemaProblems(): Promise<string[]> {
    const expected: Record<string, "YES" | "NO"> = {
        id: "NO", email: "YES", name: "NO", password_hash: "YES", role: "NO",
        created_at: "NO", updated_at: "NO", configured_at: "YES", disabled_at: "YES",
    };
    const rows = await db.select({ sql: "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users'" }) as any[];
    const have = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    const problems: string[] = [];
    for (const [col, nullable] of Object.entries(expected)) {
        if (!have.has(col)) problems.push(`users.${col} missing`);
        else if (have.get(col) !== nullable) problems.push(`users.${col} nullable=${have.get(col)}, expected ${nullable}`);
    }
    for (const [table, col] of [["agents", "created_by"], ["messages", "author"], ["events", "actor"]]) {
        const r = await one("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=? AND column_name=?", [table, col]);
        if (!r) problems.push(`${table}.${col} missing`);
        else if (r.is_nullable !== "YES") problems.push(`${table}.${col} must be nullable`);
    }
    const idx = await one("SELECT pg_get_indexdef(i.indexrelid) AS def FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='users_email_lower_idx'");
    if (!idx || !/WHERE \(?email IS NOT NULL/i.test(String(idx.def))) problems.push("users_email_lower_idx missing or not partial");
    return problems;
}

async function state() {
    const cols = await db.select({ sql: `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public' AND ((table_name='agents' AND column_name='created_by') OR (table_name='messages' AND column_name='author') OR (table_name='events' AND column_name='actor'))` }) as any[];
    const usersTable = !!(await one("SELECT to_regclass('public.users') AS t")).t;
    const migrated = !!(await one("SELECT 1 AS x FROM _migrations WHERE id = ?", [MIGRATION]))?.x;
    const users = usersTable ? (await db.select({ sql: "SELECT id, email, name, role, (password_hash IS NOT NULL) AS has_password, configured_at, disabled_at FROM users ORDER BY created_at" })) : [];
    return { usersTable, migrated, columns: cols.map((c) => `${c.table_name}.${c.column_name}`), users };
}

async function preflight() {
    const s = await state();
    const counts = await one(`SELECT (SELECT count(*) FROM agents)::bigint agents, (SELECT count(*) FROM messages)::bigint messages,
        (SELECT count(*) FROM events)::bigint events, pg_size_pretty(pg_database_size(current_database())) db_size`);
    const running = await one("SELECT count(*)::int n FROM agents WHERE run_state = 'running'");
    const longTx = await db.select({ sql: `SELECT pid, now() - xact_start AS age, state, left(query, 80) AS query FROM pg_stat_activity
        WHERE datname = current_database() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds' AND pid <> pg_backend_pid()` });
    const legacyPassword = !!(await ctx.fns.auth.password({}));
    const version = await one("SHOW server_version_num");
    return { database: safeUrl, postgres: version.server_version_num, state: s, counts, runningAgents: running.n, longTransactions: longTx, legacyPassword };
}

if (cmd === "plan") {
    const p = await preflight();
    out(p);
    const name = flag("name"), email = flag("email");
    console.log("\nPlan:");
    if (Number(p.postgres) < 110000) fail("Postgres < 11: ADD COLUMN would rewrite tables. Stop.");
    console.log(p.state.migrated ? "  • migration already applied — skip" : `  • apply ${MIGRATION}: create users + 3 nullable columns (catalog-only, no rewrite, lock_timeout 3s)`);
    if (p.state.users.length) console.log(`  • users already exist (${p.state.users.length}) — no user will be created`);
    else if (name) console.log(`  • create first user "${name}" <${email ?? "no email"}>, role owner, ${p.legacyPassword ? "password = current shared password (sign-in unchanged)" : "no password (open, as now)"}`);
    else console.log("  • no --name given: first user will not be created");
    if (has("attribute")) console.log("  • attribute existing agents / user messages to the first user (UPDATE, can be large)");
    else console.log("  • existing history keeps NULL author (no UPDATE of existing rows)");
    if (p.longTransactions.length) console.log(`  ! ${p.longTransactions.length} long transaction(s) open — migration may hit lock_timeout; rerun later`);
    if (p.runningAgents) console.log(`  ! ${p.runningAgents} agent(s) running — safe, but a brief lock may make them retry`);
    process.exit(0);
}

if (cmd === "backup") {
    const dir = flag("dir") ?? `${process.env.HOME}/hyper-backups`;
    await Bun.$`mkdir -p ${dir}`.quiet();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `${dir}/hyper-before-users-${stamp}.dump`;
    // Schema of everything + data of the core tables that the migration touches, plus settings (legacy password).
    console.log(`pg_dump → ${file}`);
    const r = await Bun.$`pg_dump --format=custom --no-owner --file=${file} --table=public.agents --table=public.messages --table=public.events --table=public.settings --table=public._migrations ${url}`.nothrow();
    if (r.exitCode !== 0) fail("pg_dump failed: " + r.stderr.toString());
    const size = (await Bun.file(file).stat()).size;
    const list = await Bun.$`pg_restore --list ${file}`.quiet().nothrow();
    if (list.exitCode !== 0) fail("backup is not readable by pg_restore");
    out({ file, bytes: size, entries: list.stdout.toString().split("\n").filter((l) => l && !l.startsWith(";")).length });
    process.exit(0);
}

if (cmd === "up") {
    const p = await preflight();
    if (Number(p.postgres) < 110000) fail("Postgres < 11. Stop.");
    if (!p.state.migrated) {
        const m = (ctx.state.procs?.migrate?.list ?? []).find((x: any) => x.id === MIGRATION);
        if (!m) fail(`migration ${MIGRATION} not found in this code`);
        await m.up(ctx);
        await db.run({ sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING", params: [MIGRATION, new Date().toISOString()] });
        console.log(`✓ applied ${MIGRATION}`);
    } else console.log(`• ${MIGRATION} already applied`);

    const shape = await schemaProblems();
    if (shape.length) fail("schema does not match the code — not creating users:\n  " + shape.join("\n  "));
    console.log("✓ schema shape verified");

    const users = await ctx.fns.auth.listUsers({ includeDisabled: true });
    let first = users[0];
    if (!first) {
        const name = flag("name");
        if (!name) fail("--name is required to create the first user");
        const legacy = await ctx.fns.auth.password({});
        first = await ctx.fns.auth.createUser({ name, email: flag("email") ?? null, password: legacy, role: "owner", configured: true });
        console.log(`✓ created ${first.id} <${first.email ?? "-"}>, owner, ${first.hasPassword ? "password carried over" : "no password"}`);
    } else console.log(`• users already exist, first = ${first.id}`);

    if (has("attribute")) {
        // Optional and resumable: batches, so it never holds long locks on the big tables.
        let total = 0;
        for (const [table, col, extra] of [["agents", "created_by", ""], ["messages", "author", "AND role = 'user'"]] as const) {
            for (;;) {
                const r: any = await db.run({ sql: `UPDATE ${table} SET ${col} = ? WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${col} IS NULL ${extra} LIMIT 5000)`, params: [first.id] });
                const n = Number(r?.count ?? r?.rowCount ?? r?.changes ?? 0);
                total += n;
                if (n === 0) break;
            }
        }
        console.log(`✓ attributed ${total} existing row(s) to ${first.id}`);
    }
    process.exit(0);
}

if (cmd === "verify") {
    const s = await state();
    const problems: string[] = [];
    if (!s.migrated) problems.push("migration not recorded");
    if (!s.usersTable) problems.push("users table missing");
    else problems.push(...await schemaProblems());
    const active = (s.users as any[]).filter((u) => !u.disabled_at);
    if (!active.length) problems.push("no active user");
    if (active.length === 1 && active[0].has_password !== (!!(await ctx.fns.auth.password({})) || active[0].has_password)) problems.push("password state unexpected");
    // Sign-in behaviour the middleware will apply.
    const mode = active.length === 0 ? "open (no users)" : active.length === 1 ? (active[0].has_password ? "password only (as today with a shared password)" : "open (as today without a password)") : "email + password";
    // Plugin schemas must be untouched: a quick check on the one we damaged before.
    let doonto: unknown = "n/a";
    if ((await one("SELECT to_regclass('doonto.graph_mentions') AS t")).t) {
        const v = await one("SELECT pg_get_viewdef('doonto.graph_mentions'::regclass, true) AS d");
        doonto = String(v.d).includes("graph_review_events") ? "ok" : "graph_mentions looks OLD — check doonto";
    }
    out({ ok: problems.length === 0, problems, signIn: mode, users: s.users, doonto });
    process.exit(problems.length ? 1 : 0);
}

if (cmd === "down") {
    // Optional cleanup ONLY. The rollback is: stop Hyper, run the previous code, start (switch.md).
    // The previous code ignores this schema. Running `down` while the new code serves requests
    // breaks it (it reads `users` on every request) and the next boot re-applies the migration.
    const s = await state();
    if (!s.usersTable && !s.migrated) { console.log("• nothing to roll back"); process.exit(0); }
    const serving = (await Bun.$`lsof -nP -iTCP:3010 -sTCP:LISTEN`.quiet().nothrow()).stdout.toString().trim();
    if (!has("yes")) {
        out({ willRemove: ["table users", "agents.created_by", "messages.author", "events.actor"], users: s.users, somethingListeningOn3010: !!serving });
        console.log("\nOptional cleanup. Only after the PREVIOUS code is running (or Hyper is stopped).");
        console.log("Re-run with --yes --old-code-running to confirm. Recorded authorship will be lost.");
        process.exit(0);
    }
    if (!has("old-code-running")) fail("confirm with --old-code-running that the previous code is live (or Hyper is stopped)");
    const m = (ctx.state.procs?.migrate?.list ?? []).find((x: any) => x.id === MIGRATION);
    if (!m?.down) fail("migration down() not found in this code");
    await m!.down(ctx);
    await db.run({ sql: "DELETE FROM _migrations WHERE id = ?", params: [MIGRATION] });
    console.log("✓ cleaned up: users removed, author columns dropped.");
    process.exit(0);
}

fail(`unknown command: ${cmd}`);
