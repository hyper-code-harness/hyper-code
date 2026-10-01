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
    return { ctx, root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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
});
