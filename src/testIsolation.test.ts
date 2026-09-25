import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "./$test";

test("core testCtx excludes inherited plugin migrations before they execute", async () => {
    const root = mkdtempSync(join(tmpdir(), "hyper-test-isolation-"));
    const previous = { USER_PLUGINS: process.env.USER_PLUGINS, PROCS_PLUGINS: process.env.PROCS_PLUGINS };
    try {
        for (const kind of ["user", "official"]) {
            const plugin = join(root, kind, `isolation-${kind}`);
            mkdirSync(join(plugin, "src", `isolation${kind}`), { recursive: true });
            writeFileSync(join(plugin, "package.json"), JSON.stringify({
                name: `isolation-${kind}`, type: "module",
                procs: { src: "src", plugin: true },
            }));
            // A tripwire, not real qualified SQL: even an unfixed harness must
            // fail safely rather than touch a production schema during this test.
            writeFileSync(join(plugin, "src", `isolation${kind}`, "$migration_9999999999999_tripwire.ts"),
                'export default { async up() { throw new Error("Installed plugin migration escaped pg_temp isolation"); } };\n');
        }
        process.env.USER_PLUGINS = join(root, "user");
        process.env.PROCS_PLUGINS = join(root, "official");
        const ctx = await testCtx();
        expect(ctx.env.USER_PLUGINS).toBe("");
        expect(ctx.env.PROCS_PLUGINS).toBe("");
        expect(ctx.fns.procs.modules.list({}).some((m: any) => m.name.startsWith("isolation-"))).toBe(false);
        expect(ctx.state.procs.migrate.list.some((m: any) => m.id.includes("tripwire"))).toBe(false);
        // Explicit fixture mounts still work, but their migration must never run
        // during core setup either (including schema-qualified migrations).
        const mounted = await testCtx({ env: { USER_PLUGINS: join(root, "user") } });
        expect(mounted.fns.procs.modules.list({}).some((m: any) => m.name === "isolation-user")).toBe(true);
        expect(mounted.state.procs.migrate.list.some((m: any) => m.id.includes("tripwire"))).toBe(false);
    } finally {
        for (const key of ["USER_PLUGINS", "PROCS_PLUGINS"] as const) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
        rmSync(root, { recursive: true, force: true });
    }
});

test("core testCtx keeps unqualified tables private to each pg_temp connection", async () => {
    const first = await testCtx();
    const second = await testCtx();
    await first.fns.procs.db.exec({ sql: "CREATE TABLE test_isolation_probe (value TEXT)" });
    await first.fns.procs.db.run({ sql: "INSERT INTO test_isolation_probe VALUES (?)", params: ["first"] });
    expect(await first.fns.procs.db.select({ sql: "SELECT value FROM test_isolation_probe" })).toEqual([{ value: "first" }]);
    const rows = await second.fns.procs.db.select({ sql: "SELECT to_regclass('test_isolation_probe')::text AS name" });
    expect(rows[0].name).toBeNull();
});
