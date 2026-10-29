// The chat's subagents badge and popup: count of working delegated children, the list, Stop, and who may see them.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const text = async (r: Response) => await r.text();

test("robot badge counts working subagents; popup lists them and Stop marks the child blocked", async () => {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.wakeWorker = () => {};
    ctx.fns.agent.wakeWorker = () => {};
    const parent = await ctx.fns.agent.start({ model: "mock:test" });
    expect(await ctx.fns.agent.teamBadge({ agentId: parent.id })).toBe("");
    const m = await ctx.fns.agent.delegate({ agent: parent, title: "Inspect logs", tasks: [{ id: "a", title: "Read the log" }, { id: "b", title: "Report" }] });
    const badge = await ctx.fns.agent.teamBadge({ agentId: parent.id });
    expect(badge).toContain('<span class="w-badge-mark">1</span>');
    expect(badge).toContain("ph-robot");
    expect(badge).toContain('hx-popup="agent.teamPopup"');

    const list = await text(await ctx.fns.agent.teamPopup({ agentId: parent.id }));
    expect(list).toContain("1 working");
    expect(list).toContain("Inspect logs");
    expect(list).toContain("0/2");
    expect(list).toContain("Read the log");
    expect(list).toContain(`/agent/${m.id}`);
    expect(list).toContain(`&quot;stop&quot;:&quot;${m.id}&quot;`);

    const stopped = await text(await ctx.fns.agent.teamPopup({ agentId: parent.id, stop: m.id }));
    expect(stopped).toContain(`Stopped ${m.id}`);
    expect(stopped).toContain("blocked");
    expect(await ctx.fns.agent.teamBadge({ agentId: parent.id })).toBe("");
    // a stranger's chat: neither the badge nor the popup
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: "insert into users (id, email, name, role, created_at, updated_at) values ('bob', 'bob@x', 'bob', 'member', ?, ?) on conflict do nothing", params: [now, now] });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET created_by = 'ann' WHERE id = ?", params: [parent.id] });
    const bob = Object.create(ctx); bob.session = { kind: "http", user: { id: "bob", role: "member" } };
    expect(await text(await bob.fns.agent.teamPopup({ agentId: parent.id }))).toContain("Not your chat");
    expect(await bob.fns.agent.teamBadge({ agentId: parent.id })).toBe("");
});
