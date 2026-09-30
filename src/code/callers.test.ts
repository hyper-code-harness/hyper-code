import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
// A chain plus a branch plus a cycle: enough shape that depth, dedup and
// termination are all actually exercised rather than asserted about.
//   $route_go_GET → orders.place → orders.charge → payments.capture
//                   orders.audit → orders.charge
//                   loop.a ⇄ loop.b
const FILES: Record<string, string> = {
    "orders/$route_go_GET.ts": `export default async function (ctx: Context) { await ctx.fns.orders.place({}); }\n`,
    "orders/place.ts": `export default async function (ctx: Context) { await ctx.fns.orders.charge({}); }\n`,
    "orders/audit.ts": `export default async function (ctx: Context) { await ctx.fns.orders.charge({}); }\n`,
    "orders/charge.ts": `export default async function (ctx: Context) { await ctx.fns.payments.capture({}); }\n`,
    "payments/capture.ts": `export default async function () { return 1; }\n`,
    "orders/orphan.ts": `export default async function () { return 1; }\n`,
    "loop/a.ts": `export default async function (ctx: Context) { await ctx.fns.loop.b({}); }\n`,
    "loop/b.ts": `export default async function (ctx: Context) { await ctx.fns.loop.a({}); }\n`,
};

async function graph() {
    const dir = mkdtempSync(join(tmpdir(), "code-callers-"));
    for (const [rel, body] of Object.entries(FILES)) {
        const abs = join(dir, "src", rel);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, body);
    }
    const ctx = await testCtx({ root: dir });
    const root = basename(dir);
    await ctx.fns.code.index({ root });
    return { ctx, dir, root, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("code.callers", () => {
    test("direct callers come back with file and line", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "payments.capture" });
            expect(r.exists).toBe(true);
            expect(r.callers).toEqual([
                { caller: "orders.charge", rel: "orders/charge.ts", line: 1, kind: "fn", depth: 1, entryPoint: false },
            ]);
        } finally { cleanup(); }
    });

    test("two callers of the same function are both reported", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "orders.charge" });
            expect(r.callers.map(c => c.caller).sort()).toEqual(["orders.audit", "orders.place"]);
        } finally { cleanup(); }
    });

    test("depth walks back to the entry point and marks it", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "payments.capture", depth: 4 });
            const byName = Object.fromEntries(r.callers.map(c => [c.caller, c]));
            expect(byName["orders.charge"]!.depth).toBe(1);
            expect(byName["orders.place"]!.depth).toBe(2);
            expect(byName["orders/$route_go_GET.ts"]!.depth).toBe(3);
            expect(byName["orders/$route_go_GET.ts"]!.entryPoint).toBe(true);
        } finally { cleanup(); }
    });

    test("depth 1 does not leak transitive callers", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "payments.capture", depth: 1 });
            expect(r.callers.map(c => c.caller)).toEqual(["orders.charge"]);
        } finally { cleanup(); }
    });

    test("a cycle terminates instead of hanging", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "loop.a", depth: 10 });
            expect(r.callers.map(c => c.caller).sort()).toEqual(["loop.a", "loop.b"]);
        } finally { cleanup(); }
    });

    test("an unknown name is reported as not found, not as an error", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "nope.missing" });
            expect(r.exists).toBe(false);
            expect(r.callers).toEqual([]);
        } finally { cleanup(); }
    });

    test("a function nobody calls returns an empty list but exists", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.callers({ name: "orders.orphan" });
            expect(r.exists).toBe(true);
            expect(r.callers).toEqual([]);
        } finally { cleanup(); }
    });
});

describe("code.dead", () => {
    test("lists uncalled functions and excludes the route", async () => {
        const { ctx, root, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.dead({ root });
            // orphan is called by nobody; audit calls charge but nothing calls
            // audit — both are genuinely unreachable. The route is not listed
            // even though no code calls it either: the framework does.
            expect(r.functions.map(f => f.name)).toEqual(["orders.audit", "orders.orphan"]);
            expect(r.total).toBe(2);
            expect(r.uncalledTotal).toBe(2);
            expect(r.testOnlyTotal).toBe(0);
        } finally { cleanup(); }
    });

    test("a function called only from a route is not dead", async () => {
        const { ctx, root, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.dead({ root });
            expect(r.functions.map(f => f.name)).not.toContain("orders.place");
        } finally { cleanup(); }
    });

    test("a function only its test calls is test-only, not uncalled", async () => {
        const { ctx, dir, root, cleanup } = await graph();
        try {
            // A test is the only thing that reaches orders.orphan.
            writeFileSync(join(dir, "src", "orders", "orphan.test.ts"),
                `import { test } from "bun:test";\ntest("orphan", async () => { await ctx.fns.orders.orphan({}); });\n`);
            await ctx.fns.code.index({ root });

            const r = await ctx.fns.code.dead({ root });
            const byName = Object.fromEntries(r.functions.map(f => [f.name, f]));
            expect(byName["orders.orphan"]!.status).toBe("test-only");
            expect(byName["orders.orphan"]!.testCallers).toBe(1);
            expect(byName["orders.audit"]!.status).toBe("uncalled");
            expect(r.uncalledTotal).toBe(1);
            expect(r.testOnlyTotal).toBe(1);
        } finally { cleanup(); }
    });

    test("includeTestOnly false narrows the list to the truly uncalled", async () => {
        const { ctx, dir, root, cleanup } = await graph();
        try {
            writeFileSync(join(dir, "src", "orders", "orphan.test.ts"),
                `import { test } from "bun:test";\ntest("orphan", async () => { await ctx.fns.orders.orphan({}); });\n`);
            await ctx.fns.code.index({ root });

            const r = await ctx.fns.code.dead({ root, includeTestOnly: false });
            expect(r.functions.map(f => f.name)).toEqual(["orders.audit"]);
        } finally { cleanup(); }
    });

    test("a test file is never itself a dead-code candidate", async () => {
        const { ctx, dir, root, cleanup } = await graph();
        try {
            writeFileSync(join(dir, "src", "orders", "orphan.test.ts"),
                `import { test } from "bun:test";\ntest("orphan", async () => { await ctx.fns.orders.orphan({}); });\n`);
            await ctx.fns.code.index({ root });

            const nodes = await ctx.fns.procs.db.select({ sql: "SELECT name FROM code_functions WHERE name LIKE '%test%'", params: [] });
            expect(nodes).toEqual([]);
        } finally { cleanup(); }
    });
});

describe("code.slice", () => {
    test("returns what it calls, who calls it, and its source", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const s = await ctx.fns.code.slice({ name: "orders.charge" });
            expect(s.found).toBe(true);
            expect(s.rel).toBe("orders/charge.ts");
            expect(s.calls.map(c => c.name)).toEqual(["payments.capture"]);
            expect(s.callers.map(c => c.caller).sort()).toEqual(["orders.audit", "orders.place"]);
            expect(s.source).toContain("payments.capture");
        } finally { cleanup(); }
    });

    test("includeSource false omits the body", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const s = await ctx.fns.code.slice({ name: "orders.charge", includeSource: false });
            expect(s.source).toBeUndefined();
            expect(s.calls.length).toBe(1);
        } finally { cleanup(); }
    });

    test("an unknown function is reported as not found", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const s = await ctx.fns.code.slice({ name: "nope.missing" });
            expect(s.found).toBe(false);
        } finally { cleanup(); }
    });
});
