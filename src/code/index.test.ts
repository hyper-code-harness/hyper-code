import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

// A throwaway project on disk, indexed for real. Fixtures beat mocks here: the
// thing under test IS the reading of files, so stubbing the files would test
// nothing but the stub.
function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "code-index-"));
    for (const [rel, body] of Object.entries(files)) {
        const abs = join(dir, "src", rel);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, body);
    }
    return dir;
}

// The scanner always also sees the framework's own src, so the fixture is
// addressed by its own root name — which is exactly the `root` filter that
// callers use to index a single plugin.
async function indexed(files: Record<string, string>) {
    const dir = fixture(files);
    const ctx = await testCtx({ root: dir });
    const root = basename(dir);
    const result = await ctx.fns.code.index({ root });
    return { ctx, dir, root, result, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("code.index", () => {
    test("records a function and the edge to what it calls", async () => {
        const { ctx, result, cleanup } = await indexed({
            "shop/checkout.ts": `export default async function (ctx: Context) {\n    await ctx.fns.shop.charge({ amount: 1 });\n}\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            expect(result.functions).toBe(2);
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee, line FROM code_calls WHERE kind = 'fn'", params: [] });
            expect(calls).toEqual([{ caller: "shop.checkout", callee: "shop.charge", line: 2 }]);
        } finally { cleanup(); }
    });

    test("a mention in a comment is not a call", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/checkout.ts": `// see ctx.fns.shop.charge({}) for the money part\nexport default async function () { return 1; }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT * FROM code_calls", params: [] });
            expect(calls).toEqual([]);
        } finally { cleanup(); }
    });

    test("sees a call through a cast and through destructured fns", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/checkout.ts": `export default async function (ctx: any) {\n    (ctx as any).fns.shop.charge({});\n    const { fns } = ctx;\n    await fns.shop.refund({});\n}\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
            "shop/refund.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn' ORDER BY callee", params: [] });
            expect(calls.map((c: any) => c.callee)).toEqual(["shop.charge", "shop.refund"]);
        } finally { cleanup(); }
    });

    test("keeps three segments for procs, two for everyone else", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/checkout.ts": `export default async function (ctx: Context) {\n    await ctx.fns.procs.db.select({ sql: "x" });\n    await ctx.fns.shop.charge({}).then(r => r);\n}\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn' ORDER BY callee", params: [] });
            expect(calls.map((c: any) => c.callee)).toEqual(["procs.db.select", "shop.charge"]);
        } finally { cleanup(); }
    });

    test("a nested module resolves to its three-part name", async () => {
        // `shop/cart/add.ts` is ctx.fns.shop.cart.add — nesting is not a
        // privilege of `procs`, and a caller of it must not be recorded as
        // calling the non-existent `shop.cart`.
        const { ctx, cleanup } = await indexed({
            "shop/cart/add.ts": `export default async function () { return 1; }\n`,
            "shop/checkout.ts": `export default async function (ctx: Context) { await ctx.fns.shop.cart.add({}); }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(calls).toEqual([{ caller: "shop.checkout", callee: "shop.cart.add" }]);
        } finally { cleanup(); }
    });

    test("a method on a call result is not mistaken for a nested function", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/checkout.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge.call({}); }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(calls.map((c: any) => c.callee)).toEqual(["shop.charge"]);
        } finally { cleanup(); }
    });

    test("indexes type files and their uses", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/Invoice.ts": `export type Invoice = { total: number };\n`,
            "shop/checkout.ts": `export default async function (ctx: Context, s: any, opts: { inv: types.shop.Invoice }) { return opts; }\n`,
        });
        try {
            const types = await ctx.fns.procs.db.select({ sql: "SELECT name, rel FROM code_types", params: [] });
            expect(types).toEqual([{ name: "shop.Invoice", rel: "shop/Invoice.ts" }]);
            const uses = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee FROM code_calls WHERE kind='type'", params: [] });
            expect(uses).toEqual([{ caller: "shop.checkout", callee: "types.shop.Invoice" }]);
        } finally { cleanup(); }
    });

    test("UI string dispatch counts as an edge", async () => {
        const { ctx, cleanup } = await indexed({
            "ui/panel.ts": `export default function () {\n    return \`<form hx-popup="shop.modalPicker"></form>\`;\n}\n`,
            "shop/modalPicker.ts": `export default async function () { return "<div/>"; }\n`,
        });
        try {
            const calls = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee, kind FROM code_calls WHERE kind='string'", params: [] });
            expect(calls).toEqual([{ caller: "ui.panel", callee: "shop.modalPicker", kind: "string" }]);
        } finally { cleanup(); }
    });

    test("a dynamic dispatch is reported, not silently dropped", async () => {
        const { result, cleanup } = await indexed({
            "shop/run.ts": `export default async function (ctx: any, s: any, opts: { name: string }) {\n    return await ctx.fns[opts.name]({});\n}\n`,
        });
        try {
            expect(result.dynamic).toEqual([{ rel: "shop/run.ts", line: 2 }]);
        } finally { cleanup(); }
    });

    test("routes are entry points, plain fns are not", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/$route_cart_GET.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge({}); }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const rows = await ctx.fns.procs.db.select({ sql: "SELECT name, kind, entry_point FROM code_functions ORDER BY name", params: [] });
            expect(rows).toEqual([
                { name: "shop$route_cart_GET.ts".replace("shop$", "shop/$"), kind: "route", entry_point: true },
                { name: "shop.charge", kind: "fn", entry_point: false },
            ]);
        } finally { cleanup(); }
    });

    test("reindexing is idempotent — no duplicate edges", async () => {
        const { ctx, root, cleanup } = await indexed({
            "shop/checkout.ts": `export default async function (ctx: Context) {\n    await ctx.fns.shop.charge({});\n}\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            await ctx.fns.code.index({ root });
            await ctx.fns.code.index({ root });
            const [{ n }] = await ctx.fns.procs.db.select({ sql: "SELECT COUNT(*) AS n FROM code_calls", params: [] });
            expect(Number(n)).toBe(1);
        } finally { cleanup(); }
    });

    test("dryRun computes counts and writes nothing", async () => {
        const dir = fixture({
            "shop/checkout.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge({}); }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        const ctx = await testCtx({ root: dir });
        try {
            const result = await ctx.fns.code.index({ root: basename(dir), dryRun: true });
            expect(result.calls).toBe(1);
            const [{ n }] = await ctx.fns.procs.db.select({ sql: "SELECT COUNT(*) AS n FROM code_calls", params: [] });
            expect(Number(n)).toBe(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    test("the reported count is what actually lands in the table", async () => {
        const { ctx, result, cleanup } = await indexed({
            // The same callee twice on one line is one edge, not two.
            "shop/checkout.ts": `export default async function (ctx: Context) {\n    return [await ctx.fns.shop.charge({}), await ctx.fns.shop.charge({})];\n}\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        try {
            const [{ n }] = await ctx.fns.procs.db.select({ sql: "SELECT COUNT(*) AS n FROM code_calls", params: [] });
            expect(result.calls).toBe(Number(n));
        } finally { cleanup(); }
    });
});

describe("code.index incremental", () => {
    test("re-indexing one file picks up its new call and leaves the rest alone", async () => {
        const dir = fixture({
            "shop/checkout.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge({}); }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
            "shop/refund.ts": `export default async function () { return 1; }\n`,
            "other/untouched.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge({}); }\n`,
        });
        const ctx = await testCtx({ root: dir });
        try {
            await ctx.fns.code.index({ root: basename(dir) });

            writeFileSync(join(dir, "src", "shop", "checkout.ts"),
                `export default async function (ctx: Context) { await ctx.fns.shop.refund({}); }\n`);
            const r = await ctx.fns.code.index({ rel: "shop/checkout.ts" });
            expect(r.functions).toBe(1);

            const edges = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee FROM code_calls ORDER BY caller, callee", params: [] });
            expect(edges).toEqual([
                { caller: "other.untouched", callee: "shop.charge" },
                { caller: "shop.checkout", callee: "shop.refund" },
            ]);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    test("a deleted file loses its edges", async () => {
        const dir = fixture({
            "shop/checkout.ts": `export default async function (ctx: Context) { await ctx.fns.shop.charge({}); }\n`,
            "shop/charge.ts": `export default async function () { return 1; }\n`,
        });
        const ctx = await testCtx({ root: dir });
        try {
            await ctx.fns.code.index({ root: basename(dir) });
            rmSync(join(dir, "src", "shop", "checkout.ts"));
            await ctx.fns.code.index({ rel: "shop/checkout.ts" });

            const edges = await ctx.fns.procs.db.select({ sql: "SELECT caller FROM code_calls", params: [] });
            expect(edges).toEqual([]);
            const fns = await ctx.fns.procs.db.select({ sql: "SELECT name FROM code_functions ORDER BY name", params: [] });
            expect(fns.map((f: any) => f.name)).toEqual(["shop.charge"]);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    // The regex this indexer used to be could not tell a call from the same text
    // quoted in a string. Both halves of that matter, so both are pinned here.
    test("a call quoted inside a string is not an edge", async () => {
        const { ctx, cleanup } = await indexed({
            // What procs.repl.explain actually does: hands a human the advice to
            // run something. Reading it as an edge invented a callee that exists
            // nowhere in the tree.
            "shop/advise.ts": 'export default function () {\n    return `run ctx.fns.shop.nosuchthing({}) to fix it`;\n}\n',
        });
        try {
            const edges = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(edges).toEqual([]);
        } finally { cleanup(); }
    });

    test("a real call inside a template interpolation is an edge", async () => {
        const { ctx, cleanup } = await indexed({
            // The line that blanking string literals destroyed: a genuine call
            // interpolated into a template.
            "shop/render.ts": 'export default function (ctx: Context) {\n    return `<p>${ctx.fns.shop.total({})}</p>`;\n}\n',
            "shop/total.ts": 'export default function () { return 42; }\n',
        });
        try {
            const edges = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(edges).toEqual([{ caller: "shop.render", callee: "shop.total" }]);
        } finally { cleanup(); }
    });

    test("a mention in a comment is not an edge", async () => {
        const { ctx, cleanup } = await indexed({
            "shop/quiet.ts": '// see ctx.fns.shop.vanished({}) for the old way\n/* and ctx.fns.shop.alsoGone({}) */\nexport default function () { return 1; }\n',
        });
        try {
            const edges = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(edges).toEqual([]);
        } finally { cleanup(); }
    });

    test("reading fns as data is not a dynamic call", async () => {
        const { result, cleanup } = await indexed({
            // procs/dev/genTypes.ts does exactly this: walks plain objects that
            // happen to have an `fns` key. The regex counted each as a dynamic
            // dispatch and reported a blind spot that was not there.
            "shop/tree.ts": 'export default function (opts: { node: any; name: string }) {\n    return opts.node.fns[opts.name];\n}\n',
        });
        try {
            expect(result.dynamic).toEqual([]);
        } finally { cleanup(); }
    });

    test("a dotted string that is not dispatch stays out of the graph", async () => {
        const { ctx, cleanup } = await indexed({
            // Chrome DevTools Protocol command names look exactly like runtime
            // function names. 32 of them used to arrive as unresolved edges.
            "browser/send.ts": 'export default async function (ctx: Context) {\n    const cmd = "Input.dispatchMouseEvent";\n    return await ctx.fns.browser.raw({ cmd });\n}\n',
            "browser/raw.ts": 'export default async function () { return 1; }\n',
        });
        try {
            const strings = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='string'", params: [] });
            expect(strings).toEqual([]);
            const real = await ctx.fns.procs.db.select({ sql: "SELECT callee FROM code_calls WHERE kind='fn'", params: [] });
            expect(real).toEqual([{ callee: "browser.raw" }]);
        } finally { cleanup(); }
    });

    test("a popup descriptor's method is an edge", async () => {
        const { ctx, cleanup } = await indexed({
            // src/ui/chatColumn.ts dispatches this way: not an HTML attribute,
            // a property value the htmx layer resolves at request time.
            "ui/bar.ts": "export default function (ctx: Context) {\n    return ctx.fns.ui.popup({ method: 'shop.picker', params: {} });\n}\n",
            "ui/popup.ts": 'export default function () { return ""; }\n',
            "shop/picker.ts": 'export default function () { return ""; }\n',
        });
        try {
            const strings = await ctx.fns.procs.db.select({ sql: "SELECT caller, callee FROM code_calls WHERE kind='string'", params: [] });
            expect(strings).toEqual([{ caller: "ui.bar", callee: "shop.picker" }]);
        } finally { cleanup(); }
    });

});
