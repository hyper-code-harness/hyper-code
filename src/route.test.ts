import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "./_testCtx.entry";

describe("GET /", () => {
    test("no agents — renders page with '+ new agent' link", async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: "/" });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("/agent/new");
        expect(html).toContain("No agents yet");
    });

    // "/" is the home page (home.render), not a redirect into the latest chat
    test("agents exist — home lists them and offers to resume the latest", async () => {
        const ctx = await mkTestCtx();
        // DB-first: the route reads session.list, so the agent must be persisted.
        const agent = await ctx.fns.agent.start({ model: "mock:echo" });
        await ctx.fns.session.save({ agent });
        const res = await ctx.fns.procs.http.dispatch({ url: "/" });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`href="/agent/${agent.id}" class="text-xs text-primary">Resume latest`);
        expect(html).not.toContain("No agents yet");
    });
});
