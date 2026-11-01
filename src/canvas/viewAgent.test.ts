import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";

// An instance without sign-in and without an owner: a canvas panel request carries no person and no agent on its
// session, so a memory view on a tab had nobody to read as. The tab knows whose it is and says so.
describe("canvas view tab reads as its agent", () => {
    test("rpc.render takes agentId when the session has neither a person nor an agent; the view tab passes it", async () => {
        const ctx: any = await mkTestCtx({ env: { HYPER_HOME: await mkdtemp(join(tmpdir(), "view-agent-")) } });
        await ctx.fns.procs.db.run({ sql: "DELETE FROM users WHERE role = 'owner'", params: [] });
        const a = await ctx.fns.agent.start({ model: "mock:echo" });
        await ctx.fns.session.save({ agent: a });
        const as = Object.create(ctx); as.session = { kind: "agent", agentId: a.id };
        await as.fns.memory.write({ path: "notes/tab.md", content: "Tab note body", title: "Tab", description: "t" });

        const http = Object.create(ctx); http.session = { kind: "http" };
        const bare = await http.fns.rpc.render({ fn: "memory.view", params: { key: "notes/tab.md" } });
        expect(bare.html).not.toContain("Tab note body");
        const own = await http.fns.rpc.render({ fn: "memory.view", params: { key: "notes/tab.md" }, agentId: a.id });
        expect(own.status).toBe(200);
        expect(own.html).toContain("Tab note body");

        const item = await ctx.fns.canvas.show({ agentId: a.id, kind: "view", args: { fn: "memory.view", params: { key: "notes/tab.md" } } });
        expect(item).toBeTruthy();
        const panel = await http.fns.canvas.panelHtml({ agentId: a.id });
        expect(panel).toContain("Tab note body");
    });
});
