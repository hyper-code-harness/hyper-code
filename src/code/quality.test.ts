import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

async function indexed(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "code-quality-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = join(dir, "src", rel);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, body);
    }
    const ctx = await testCtx({ root: dir });
    const root = basename(dir);
    await ctx.fns.code.index({ root });
    return { ctx, root, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("code.quality", () => {
    test("an uncalled function is a warning, and the codebase stays ok", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/orphan.ts": `export default function () { return 1; }\n`,
            "shop/$route_go_GET.ts": `export default async function () { return new Response("ok"); }\n`,
        });
        try {
            const q = await ctx.fns.code.quality({ root, limit: 10 });
            // A smell, not a broken build: a gate that fails on these gets turned off.
            expect(q.ok).toBe(true);
            expect(q.errors).toBe(0);
            expect(q.counts.dead).toBe(1);
            expect(q.findings[0]!.name).toBe("shop.orphan");
            // The route is invoked by the framework and must never be called dead.
            expect(q.findings.some((f: any) => f.name.includes("route"))).toBe(false);
        } finally { cleanup(); }
    });

    test("a function only its own test calls is reported apart from the uncalled", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/helper.ts": `export default function () { return 1; }\n`,
            "shop/helper.test.ts": `import { test } from "bun:test";\ntest("x", async () => { await (globalThis as any).ctx.fns.shop.helper({}); });\n`,
        });
        try {
            const q = await ctx.fns.code.quality({ root, limit: 10 });
            expect(q.counts["test-only"]).toBe(1);
            expect(q.counts.dead).toBeUndefined();
            expect(q.findings[0]!.detail).toContain("only its own test");
        } finally { cleanup(); }
    });

    test("include narrows the checks that run", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/orphan.ts": `export default function () { return 1; }\n`,
        });
        try {
            const only = await ctx.fns.code.quality({ root, include: ["boundary"], limit: 10 });
            expect(only.findings).toEqual([]);
            expect(only.counts.dead).toBeUndefined();
        } finally { cleanup(); }
    });

    test("severity filters the list and still reports ok honestly", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/orphan.ts": `export default function () { return 1; }\n`,
        });
        try {
            const warns = await ctx.fns.code.quality({ root, severity: "warn", limit: 10 });
            expect(warns.warnings).toBe(1);
            expect(warns.ok).toBe(true);

            const errs = await ctx.fns.code.quality({ root, severity: "error", limit: 10 });
            expect(errs.findings).toEqual([]);
            expect(errs.ok).toBe(true);
        } finally { cleanup(); }
    });

    test("it says what it cannot see", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/one.ts": `export default function () { return 1; }\n`,
        });
        try {
            const q = await ctx.fns.code.quality({ root });
            // A checker that implies it sees everything is worse than none: raw
            // SQL across schemas and computed dispatch are genuinely invisible.
            expect(q.blind.length).toBeGreaterThan(2);
            expect(q.blind.join(" ")).toContain("raw SQL");
        } finally { cleanup(); }
    });

    test("a clean tree reports nothing at all", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/$route_go_GET.ts": `export default async function (ctx: Context) { return await ctx.fns.shop.total({}); }\n`,
            "shop/total.ts": `export default function () { return 42; }\n`,
        });
        try {
            const q = await ctx.fns.code.quality({ root, limit: 10 });
            expect(q.ok).toBe(true);
            expect(q.findings).toEqual([]);
            expect(q.warnings).toBe(0);
        } finally { cleanup(); }
    });

    test("a rule violation reaches the report through the table", async () => {
        const { ctx, root, cleanup } = await indexed({
            // Written by the indexer while it parses, read back by a SELECT —
            // the whole project stays checked without re-reading any file.
            "shop/risky.ts": 'export default function () {\n    try { go(); } catch {}\n}\n',
            "shop/$route_go_GET.ts": 'export default async function (ctx: Context) { return await ctx.fns.shop.risky({}); }\n',
        });
        try {
            const q = await ctx.fns.code.quality({ root, limit: 10 });
            const found = q.findings.find(f => f.kind === "empty-catch");
            expect(found).toBeDefined();
            expect(found!.rel).toBe("shop/risky.ts");
            expect(found!.line).toBe(2);
        } finally { cleanup(); }
    });

    test("rule narrows the whole report, not just one check", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/risky.ts": 'export default function () {\n    try { go(); } catch {}\n}\n',
            "shop/orphan.ts": 'export default function () { return 1; }\n',
        });
        try {
            const only = await ctx.fns.code.quality({ root, rule: "empty-catch", limit: 10 });
            expect(only.findings.every(f => f.kind === "empty-catch")).toBe(true);
            expect(only.findings.length).toBe(1);
            // The dead function is still there when nothing is filtered out.
            const all = await ctx.fns.code.quality({ root, limit: 10 });
            expect(all.findings.some(f => f.kind === "dead")).toBe(true);
        } finally { cleanup(); }
    });

    test("an unawaited call to an async function is reported", async () => {
        const { ctx, root, cleanup } = await indexed({
            // Neither half is a finding alone: the call site knows the result is
            // dropped, the callee knows it returns a promise. Only the join is.
            "shop/caller.ts": 'export default async function (ctx: Context) {\n    ctx.fns.shop.slow({});\n    return 1;\n}\n',
            "shop/slow.ts": 'export default async function () { return 2; }\n',
        });
        try {
            const q = await ctx.fns.code.quality({ root, rule: "floating-promise", limit: 10 });
            expect(q.findings.length).toBe(1);
            expect(q.findings[0]!.rel).toBe("shop/caller.ts");
            expect(q.findings[0]!.line).toBe(2);
        } finally { cleanup(); }
    });

    test("an unawaited call to a SYNC function is not a floating promise", async () => {
        const { ctx, root, cleanup } = await indexed({
            // A text scan that skipped this reported 199 of these; 189 were calls
            // to synchronous functions, where there is nothing to await.
            "shop/caller.ts": 'export default async function (ctx: Context) {\n    ctx.fns.shop.quick({});\n    return 1;\n}\n',
            "shop/quick.ts": 'export default function () { return 2; }\n',
        });
        try {
            const q = await ctx.fns.code.quality({ root, rule: "floating-promise", limit: 10 });
            expect(q.findings).toEqual([]);
        } finally { cleanup(); }
    });

    test("awaiting, returning or voiding the call clears it", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/a.ts": 'export default async function (ctx: Context) {\n    await ctx.fns.shop.slow({});\n}\n',
            "shop/b.ts": 'export default function (ctx: Context) {\n    return ctx.fns.shop.slow({});\n}\n',
            "shop/c.ts": 'export default function (ctx: Context) {\n    ctx.fns.shop.slow({}).catch(() => {});\n}\n',
            "shop/d.ts": 'export default function (ctx: Context) {\n    void ctx.fns.shop.slow({});\n}\n',
            "shop/slow.ts": 'export default async function () { return 2; }\n',
        });
        try {
            const q = await ctx.fns.code.quality({ root, rule: "floating-promise", limit: 10 });
            expect(q.findings).toEqual([]);
        } finally { cleanup(); }
    });

    test("re-indexing one file replaces only its own findings", async () => {
        const { ctx, root, dir, cleanup } = await indexed({
            "shop/risky.ts": 'export default function () {\n    try { go(); } catch {}\n}\n',
            "shop/other.ts": 'export default function () {\n    try { go(); } catch {}\n}\n',
        });
        try {
            expect((await ctx.fns.code.quality({ root, rule: "empty-catch", limit: 10 })).findings.length).toBe(2);
            await Bun.write(`${dir}/src/shop/risky.ts`, 'export default function () { return 1; }\n');
            await ctx.fns.code.index({ rel: "shop/risky.ts" });
            const after = await ctx.fns.code.quality({ root, rule: "empty-catch", limit: 10 });
            expect(after.findings.length).toBe(1);
            expect(after.findings[0]!.rel).toBe("shop/other.ts");
        } finally { cleanup(); }
    });

});
