import { describe, expect, test } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });   // official plugins only, not this machine's user plugins

describe("plugins.search", () => {
    test("finds a mounted plugin function and groups by owner", async () => {
        const result = await ctx.fns.plugins.search({ query: "download arxiv pdf paper", mode: "lexical" });
        const arxiv = result.find((row: any) => row.plugin === "arxiv");
        expect(arxiv).toBeDefined();
        expect(arxiv!.functions.some((fn: any) => fn.name === "arxiv.download")).toBe(true);
    });

    test("finds workflow text from SKILL.md even without a function phrase", async () => {
        ctx.fns.embeddings.provider = async () => "off";
        ctx.state.registry.llm.localize = async (_c: any, _s: any, opts: any) => ({ provider: "test", model: "test", localized: Object.fromEntries(opts.functions.map((fn: any) => [fn.name, fn.text.repeat(2)])) });
        await ctx.fns.procs.migrate.up({});
        await ctx.fns.plugins.index({ force: true });
        const result = await ctx.fns.plugins.search({ query: "logged-in Consensus web subscription", mode: "bm25" });
        const research = result.find((row: any) => row.plugin === "research");
        expect(research).toBeDefined();
        expect(research!.pluginEvidence?.evidence).toBe("plugin-bm25");
    });

});
