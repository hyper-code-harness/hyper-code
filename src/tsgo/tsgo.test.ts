// tsgo language server as the eval typechecker: real tsgo process, real project.
// Skipped when @typescript/native-preview is not installed.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkTestCtx } from "../_testCtx.entry";

const ROOT = join(import.meta.dir, "../..");
const installed = existsSync(join(ROOT, "node_modules/@typescript", `native-preview-${process.platform}-${process.arch}`, "lib", "tsgo"));
const PROBE = join(ROOT, "src/__tsgo_test_probe__.ts");
let ctx: any;

describe.skipIf(!installed)("tsgo eval typechecker", () => {
    beforeAll(async () => {
        ctx = await mkTestCtx({ db: false });
        // Warm up: the first check loads the project (~0.3–1 s).
        await ctx.fns.tsgo.check({ code: "return 0", timeoutMs: 60_000 });
    }, 90_000);

    afterAll(async () => {
        rmSync(PROBE, { force: true });
        await ctx?.state?.tsgo?.client?.close();
    });

    test("finds type errors with lines relative to the eval body", async () => {
        const r = await ctx.fns.tsgo.check({ code: "\nconst x: number = 'a';\nreturn x" });
        expect(r.ok).toBe(false);
        expect(r.errors).toEqual(["2:7 Type 'string' is not assignable to type 'number'."]);
    });

    test("sees project types, ctx.fns signatures and bindings", async () => {
        expect((await ctx.fns.tsgo.check({ code: "return ctx.fns.workspace.resolve({ path: 'a' }).length" })).ok).toBe(true);
        const bad = await ctx.fns.tsgo.check({ code: "return ctx.fns.workspace.nope({})" });
        expect(bad.errors[0]).toContain("Property 'nope' does not exist");
        expect((await ctx.fns.tsgo.check({ code: "return agent.id.toUpperCase()", bindings: { agent: {} } })).ok).toBe(true);
    });

    test("reports syntax errors and only error-severity diagnostics", async () => {
        expect((await ctx.fns.tsgo.check({ code: "return (" })).errors).toEqual(["2:1 Expression expected."]);
        // an unused local is a suggestion, not an error
        expect((await ctx.fns.tsgo.check({ code: "const unused = 1; return 2" })).ok).toBe(true);
    });

    test("picks up files created and changed on disk", async () => {
        writeFileSync(PROBE, "export const probeValue: number = 1;\n");
        await Bun.sleep(200);
        const code = "const m = await import('./__tsgo_test_probe__'); const s: string = m.probeValue; return s";
        expect((await ctx.fns.tsgo.check({ code })).ok).toBe(false);
        writeFileSync(PROBE, "export const probeValue: string = 'x';\n");
        await Bun.sleep(200);
        expect((await ctx.fns.tsgo.check({ code })).ok).toBe(true);
    });

    test("warm checks are fast and do not block the event loop", async () => {
        const h = monitorEventLoopDelay({ resolution: 10 });
        h.enable();
        const t = performance.now();
        for (let i = 0; i < 20; i++) await ctx.fns.tsgo.check({ code: `return ${i}` });
        const avg = (performance.now() - t) / 20;
        h.disable();
        expect(avg).toBeLessThan(50);
        expect(h.max / 1e6).toBeLessThan(60);
    });

    test("concurrent checks do not mix up their documents", async () => {
        const results = await Promise.all([
            ctx.fns.tsgo.check({ code: "const a: number = 'x'; return a" }),
            ctx.fns.tsgo.check({ code: "return 1" }),
            ctx.fns.tsgo.check({ code: "const b: string = 1; return b" }),
        ]);
        expect(results.map((r: any) => r.ok)).toEqual([false, true, false]);
        expect(results[2].errors[0]).toContain("'number' is not assignable to type 'string'");
    });

    test("a killed server restarts on the next check", async () => {
        const pid = ctx.state.tsgo.client.pid;
        process.kill(pid, "SIGKILL");
        await Bun.sleep(100);
        const r = await ctx.fns.tsgo.check({ code: "return 1", timeoutMs: 30_000 });
        expect(r.ok).toBe(true);
        expect(ctx.state.tsgo.client.pid).not.toBe(pid);
        const st = await ctx.fns.tsgo.status({});
        expect(st).toMatchObject({ installed: true, running: true });
    }, 60_000);

    test("review: restarting does not let the old client close the new client's watchers", async () => {
        const first = ctx.state.tsgo.client;
        await ctx.fns.tsgo.server({ restart: true });
        await ctx.fns.tsgo.check({ code: "return 0", timeoutMs: 30_000 });
        expect(ctx.state.tsgo.client).not.toBe(first);
        await Bun.sleep(200); // let the old process's exit handler run
        writeFileSync(PROBE, "export const probeValue: number = 5;\n");
        await Bun.sleep(200);
        const code = "const m = await import('./__tsgo_test_probe__'); const s: string = m.probeValue; return s";
        expect((await ctx.fns.tsgo.check({ code })).ok).toBe(false);
    }, 60_000);

    test("review: a server that stops answering is dropped instead of slowing every check", async () => {
        const client = ctx.state.tsgo.client;
        process.kill(client.pid, "SIGSTOP");
        try {
            await expect(ctx.fns.tsgo.check({ code: "return 1", timeoutMs: 300 })).rejects.toThrow("timed out");
        } finally {
            try { process.kill(client.pid, "SIGCONT"); } catch { /* already gone */ }
        }
        await Bun.sleep(300);
        expect(client.alive).toBe(false);
        const t = performance.now();
        expect((await ctx.fns.tsgo.check({ code: "return 1", timeoutMs: 30_000 })).ok).toBe(true);
        expect(ctx.state.tsgo.client).not.toBe(client);
        expect(performance.now() - t).toBeLessThan(10_000);
    }, 60_000);

    test("procs.repl.typecheck uses tsgo and falls back to the in-process service when disabled", async () => {
        expect((await ctx.fns.procs.repl.typecheck({ code: "return 1" })).engine).toBe("tsgo");
        ctx.env.TSGO_TYPECHECK = "false";
        try {
            const r = await ctx.fns.procs.repl.typecheck({ code: "const x: number = 'a'; return x" });
            expect(r.engine).toBe("tsserver");
            expect(r.ok).toBe(false);
        } finally {
            delete ctx.env.TSGO_TYPECHECK;
        }
    }, 60_000);
});
