import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

//   $route_go_GET → orders.place → orders.charge → payments.capture
//                   orders.audit → orders.charge
// orders/charge.test.ts calls orders.charge; nothing tests orders.audit.
const FILES: Record<string, string> = {
    "orders/$route_go_GET.ts": `export default async function (ctx: Context) { await ctx.fns.orders.place({}); }\n`,
    "orders/place.ts": `export default async function (ctx: Context) { await ctx.fns.orders.charge({}); }\n`,
    "orders/audit.ts": `export default async function (ctx: Context) { await ctx.fns.orders.charge({}); }\n`,
    "orders/charge.ts": `export default async function (ctx: Context) { await ctx.fns.payments.capture({}); }\n`,
    "orders/charge.test.ts": `import { test } from "bun:test";\ntest("charge", async () => { await ctx.fns.orders.charge({}); });\n`,
    "payments/capture.ts": `export default async function () { return 1; }\n`,
};

async function graph() {
    const dir = mkdtempSync(join(tmpdir(), "code-impact-"));
    for (const [rel, body] of Object.entries(FILES)) {
        const abs = join(dir, "src", rel);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, body);
    }
    const ctx = await testCtx({ root: dir });
    await ctx.fns.code.index({ root: basename(dir) });
    return { ctx, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("code.impact", () => {
    test("rings, entry points, tests and untested functions in one answer", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.impact({ name: "payments.capture", depth: 4 });
            expect(r.targets).toEqual(["payments.capture"]);
            expect(r.direct).toBe(1);
            expect(r.total).toBe(4);
            expect(r.rings.map(x => [x.depth, x.functions])).toEqual([[1, 1], [2, 2], [3, 1]]);
            expect(r.entryPoints).toEqual(["orders.$route_go_GET"]);
            expect(r.tests.files.some(f => f.endsWith("orders/charge.test.ts"))).toBe(true);
            expect(r.tests.command.startsWith("bun test ")).toBe(true);
            // A test reaches charge → capture, so both count as covered; audit and place are not.
            expect(r.untested).toEqual(["orders.audit", "orders.place"]);
            expect(r.readFirst[0]!.endsWith("payments/capture.ts")).toBe(true);
            expect(r.summary).toContain("1 direct callers");
        } finally { cleanup(); }
    });

    test("depth limits the radius and limit truncates only the call-site list", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.impact({ name: "payments.capture", depth: 1, limit: 0 });
            expect(r.total).toBe(1);
            expect(r.callers).toEqual([]);
            expect(r.truncated).toBe(true);
        } finally { cleanup(); }
    });

    test("a typo comes back as notFound with suggestions", async () => {
        const { ctx, cleanup } = await graph();
        try {
            const r = await ctx.fns.code.impact({ name: "payments.captur" });
            expect(r.targets).toEqual([]);
            expect(r.notFound[0]!.suggestions).toContain("payments.capture");
        } finally { cleanup(); }
    });
});
