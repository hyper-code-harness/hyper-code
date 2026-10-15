import { describe, expect, test } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });   // official plugins only, not this machine's user plugins

describe("plugins.index", () => {
    test("stores each mounted plugin once with SKILL workflow text", async () => {
        await ctx.fns.procs.migrate.up({});
        ctx.fns.embeddings.provider = async () => "off";
        ctx.state.registry.llm.localize = async (_c: any, _s: any, opts: any) => ({ provider: "test", model: "test", localized: Object.fromEntries(opts.functions.map((fn: any) => [fn.name, fn.text.repeat(2)])) });
        const result = await ctx.fns.plugins.index({});
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT name,skill_text,search_text FROM plugin_docs WHERE name IN (?,?) ORDER BY name", params: ["arxiv", "research"] });
        expect(result.indexed).toBeGreaterThanOrEqual(2);
        expect(rows.map((row: any) => row.name)).toEqual(["arxiv", "research"]);
        expect(rows[0].skill_text).toContain("public arXiv Atom API");
        expect(rows[1].search_text).toContain("official Consensus REST API");   // from plugins/research/SKILL.md
    });
});
