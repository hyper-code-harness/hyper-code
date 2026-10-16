import assert from "node:assert/strict";
// Standalone runner: never loads the repository's DB-backed test preload.
let pending = Promise.resolve();
let passed = 0;
function test(name: string, check: () => Promise<void>) {
    pending = pending.then(async () => {
        await check();
        passed++;
        console.log(`PASS ${name}`);
    });
}
function expect(value: any) {
    return {
        toBe: (other: any) => assert.equal(value, other),
        toContain: (part: string) => assert.ok(value.includes(part)),
        toBeLessThan: (other: number) => assert.ok(value < other),
        toBeGreaterThan: (other: number) => assert.ok(value > other),
        not: {
            toContain: (part: string) => assert.ok(!value.includes(part)),
            toMatch: (pattern: RegExp) => assert.ok(!pattern.test(value)),
        },
    };
}
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Subprocess tests only: no database connections or mutation, including test DBs.
const script = join(import.meta.dir, "prepare.ts");
async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
}
async function fixture(check: (manifest: Record<string, unknown>, path: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "scratchpad-reset-test-"));
    try {
        const backupPath = join(dir, "backup.dump");
        await Bun.write(backupPath, "fixture backup bytes; not a real database dump");
        const sha256 = createHash("sha256").update(await Bun.file(backupPath).bytes()).digest("hex");
        await check({ database: "test_database", backupPath, sha256, runtimeStopped: true }, join(dir, "manifest.json"));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

test("no default apply; unknown arguments fail closed", async () => {
    for (const args of [[], ["--apply"], ["--dry-run", "extra"]]) {
        const result = await run(args);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
    }
});
test("dry run is read-only, tolerates raw invalid JSON and does not require backup", async () => {
    const result = await run(["--dry-run"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("BEGIN READ ONLY");
    expect(result.stdout).not.toMatch(/UPDATE|DELETE|ALTER|CREATE|::json/i);
});
test("backup, checksum and stopped runtime are mandatory", async () => {
    await fixture(async (manifest, path) => {
        for (const patch of [{ database: "" }, { backupPath: "relative.dump" }, { sha256: "0".repeat(64) }, { runtimeStopped: false }, { backupPath: "/nonexistent/reset-backup.dump" }]) {
            await Bun.write(path, JSON.stringify({ ...manifest, ...patch }));
            const result = await run(["--prepare-apply", path]);
            expect(result.code).toBe(1);
            expect(result.stdout).toBe("");
        }
    });
});
test("generated artifact gates all writes and records marker before atomic reset", async () => {
    await fixture(async (manifest, path) => {
        await Bun.write(path, JSON.stringify(manifest));
        const result = await run(["--prepare-apply", path]);
        expect(result.code).toBe(0);
        const sql = result.stdout;
        for (const guard of ["rolsuper", "current_database() <>", "datallowconn", "pg_stat_activity", "pg_prepared_xacts", "ACCESS EXCLUSIVE", "PRIMARY KEY"]) expect(sql).toContain(guard);
        const update = sql.indexOf("UPDATE public.agents SET scratchpad = '{}';");
        expect(sql.indexOf("INSERT INTO public.agent_scratchpad_reset_receipt")).toBeLessThan(update);
        expect(sql.indexOf("BEGIN;")).toBeLessThan(update);
        expect(sql.indexOf("COMMIT;")).toBeGreaterThan(update);
        expect(sql).not.toMatch(/pg_terminate_backend|ALTER DATABASE|::json|_migrations/);
        expect(sql.match(/UPDATE public\.agents/g)?.length).toBe(1);
    });
});
test("manifest strings are quoted SQL data, not DO block interpolation", async () => {
    await fixture(async (manifest, path) => {
        await Bun.write(path, JSON.stringify({ ...manifest, database: "db'; DROP TABLE agents; -- $reset$" }));
        const result = await run(["--prepare-apply", path]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("'db''; DROP TABLE agents; -- $reset$'");
        const body = result.stdout.split("DO $reset$")[1].split("$reset$;")[0];
        expect(body).not.toContain("DROP TABLE");
    });
});
await pending;
console.log(`${passed} tests passed (no DB connections)`);
