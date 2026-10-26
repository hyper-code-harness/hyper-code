import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("renderStatusBar: quiet when idle, a w.badge for errors and parking, no custom markup", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.save({ agent });
    const idle = await ctx.fns.agent.renderStatusBar({ agentId: agent.id });
    expect(idle).toContain('id="status-bar"');
    expect(idle).not.toContain("w-badge");
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET last_error = ? WHERE id = ?", params: ["boom <x>", agent.id] });
    const err = await ctx.fns.agent.renderStatusBar({ agentId: agent.id });
    expect(err).toContain('class="w-badge" data-tone="danger">error: boom &lt;x&gt;');
    expect(err).toContain("send a message to retry");
    expect(err.replace(/class="(w-|wx-)[^"]*"/g, "")).not.toContain("class=");
});
