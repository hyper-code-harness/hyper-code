import { test, expect, describe } from "bun:test";
import { testCtx } from "../$test";

// The tiers come from the mount table, which a temporary fixture project cannot
// produce: `modules.list` reports what this process actually mounted. So these
// tests write the graph rows directly. That is the honest seam — boundary.ts is
// a query over code_functions.tier, and this is exactly the shape it queries.
async function seed(ctx: any, rows: Array<{ name: string; tier: string; rel?: string }>, edges: Array<[string, string, string?]>) {
    for (const r of rows) {
        await ctx.fns.procs.db.run({
            sql: "INSERT INTO code_functions (name, kind, rel, root, entry_point, indexed_at, tier) VALUES (?,?,?,?,?,?,?)",
            params: [r.name, "fn", r.rel ?? `${r.name.replace(".", "/")}.ts`, "t", false, Date.now(), r.tier],
        });
    }
    let line = 1;
    for (const [caller, callee, kind] of edges) {
        await ctx.fns.procs.db.run({
            sql: "INSERT INTO code_calls (caller, callee, rel, line, kind) VALUES (?,?,?,?,?)",
            params: [caller, callee, `${caller.replace(".", "/")}.ts`, line++, kind ?? "fn"],
        });
    }
}

describe("code.boundary", () => {
    test("core calling a private user plugin is an error", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "api.health", tier: "core" }, { name: "applehealth.ingest", tier: "user" }],
            [["api.health", "applehealth.ingest"]]);

        const r = await ctx.fns.code.boundary({});
        expect(r.ok).toBe(false);
        expect(r.errors).toBe(1);
        expect(r.violations[0]!.severity).toBe("error");
        expect(r.violations[0]!.callee).toBe("applehealth.ingest");
        // The message has to name the module and say why, or nobody acts on it.
        expect(r.violations[0]!.reason).toContain("applehealth");
        expect(r.violations[0]!.reason).toContain("fresh clone");
    });

    test("core calling an official plugin is a warning, not an error", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "api.news", tier: "core" }, { name: "news.list", tier: "official" }],
            [["api.news", "news.list"]]);

        const r = await ctx.fns.code.boundary({});
        // A clone HAS the plugin, so the build is not broken — ok stays true.
        expect(r.ok).toBe(true);
        expect(r.errors).toBe(0);
        expect(r.warnings).toBe(1);
        expect(r.violations[0]!.severity).toBe("warn");
    });

    test("a plugin calling core is fine — that is the direction dependencies go", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "news.list", tier: "official" }, { name: "procs.db.select", tier: "core" },
             { name: "applehealth.ingest", tier: "user" }],
            [["news.list", "procs.db.select"], ["applehealth.ingest", "procs.db.select"], ["applehealth.ingest", "news.list"]]);

        const r = await ctx.fns.code.boundary({});
        expect(r.total).toBe(0);
        expect(r.ok).toBe(true);
    });

    test("the local .hyper glue layer may reach anywhere", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "skill.meetingReady", tier: "local" }, { name: "circleback.sql", tier: "user" }],
            [["skill.meetingReady", "circleback.sql"]]);

        const r = await ctx.fns.code.boundary({});
        // .hyper/ is committed but personal: wiring private plugins is its job,
        // so reporting it would report the feature.
        expect(r.total).toBe(0);
        expect(r.ok).toBe(true);
    });

    test("test files are ignored unless asked for", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "api.health", tier: "core" }, { name: "applehealth.ingest", tier: "user" }],
            [["api.health", "applehealth.ingest", "test"]]);

        expect((await ctx.fns.code.boundary({})).total).toBe(0);
        expect((await ctx.fns.code.boundary({ includeTests: true })).errors).toBe(1);
    });

    test("filters by originating tier and by severity", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "api.health", tier: "core" }, { name: "applehealth.ingest", tier: "user" },
             { name: "news.list", tier: "official" }, { name: "pdf.convert", tier: "official" }],
            [["api.health", "applehealth.ingest"], ["api.health", "news.list"], ["pdf.convert", "applehealth.ingest"]]);

        const all = await ctx.fns.code.boundary({});
        expect(all.total).toBe(3);
        expect(all.byPair).toEqual({ "core -> user": 1, "core -> official": 1, "official -> user": 1 });

        expect((await ctx.fns.code.boundary({ from: "official" })).total).toBe(1);
        expect((await ctx.fns.code.boundary({ severity: "error" })).total).toBe(2);
        expect((await ctx.fns.code.boundary({ severity: "warn" })).total).toBe(1);
    });

    test("errors are listed before warnings", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "a.one", tier: "core", rel: "a/one.ts" }, { name: "news.list", tier: "official" },
             { name: "z.last", tier: "core", rel: "z/last.ts" }, { name: "priv.thing", tier: "user" }],
            // Ordered so that the warning would come first if nothing sorted.
            [["a.one", "news.list"], ["z.last", "priv.thing"]]);

        const r = await ctx.fns.code.boundary({});
        expect(r.violations.map((v: any) => v.severity)).toEqual(["error", "warn"]);
    });

    test("an edge to an unknown callee is not a violation", async () => {
        const ctx = await testCtx({});
        await seed(ctx,
            [{ name: "api.health", tier: "core" }],
            [["api.health", "nosuch.module"]]);

        // An unresolved callee is a different problem, reported by code.index.
        // Guessing its tier here would invent violations out of typos.
        const r = await ctx.fns.code.boundary({});
        expect(r.total).toBe(0);
    });
});
