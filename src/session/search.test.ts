import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.search", () => {
    test("matches substring in user messages across all agents", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "m" });
        await ctx.fns.session.appendMessage({ id: a.id, message: { role: "user", content: "how to deploy the telescope" } });

        const b = await ctx.fns.agent.start({ model: "m" });
        await ctx.fns.session.appendMessage({ id: b.id, message: { role: "user", content: "what is the weather" } });

        const hits = await ctx.fns.session.search({ query: "telescope" });
        expect(hits).toHaveLength(1);
        expect(hits[0]!.agentId).toBe(a.id);
        expect(hits[0]!.content).toContain("telescope");
        expect(hits[0]!.role).toBe("user");
    });

    test("matches assistant and tool content too, case-insensitive", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "m" });
        await ctx.fns.session.replaceMessages({ id: a.id, messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "The ANSWER is forty-two" },
            { role: "tool", tool_call_id: "c1", content: "42" },
        ] });
        const hits = await ctx.fns.session.search({ query: "answer" });
        expect(hits.map((h: any) => h.role)).toContain("assistant");
    });

    test("empty query or no matches → []", async () => {
        const ctx: any = await mkTestCtx();
        const a = await ctx.fns.agent.start({ model: "m" });
        await ctx.fns.session.appendMessage({ id: a.id, message: { role: "user", content: "hello" } });
        expect(await ctx.fns.session.search({ query: "xyzzy" })).toEqual([]);
    });
});
