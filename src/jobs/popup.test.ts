// The chat's background-jobs badge and popup: count, list with tail, one job's log, Stop, and who may see them.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const text = async (r: Response) => await r.text();
async function until(ctx: any, id: string, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET next_at = 0 WHERE id = ? AND status = 'running'", params: [id] });
        await ctx.fns.jobs.poll({});
        const j = await ctx.fns.jobs.get({ id });
        if (j.status !== "running") return j;
        await Bun.sleep(150);
    }
    throw new Error("job still running: " + id);
}
const as = (ctx: any, user: { id: string; role: "owner" | "member" }) => { const c = Object.create(ctx); c.session = { kind: "http", user }; return c; };

test("badge counts running jobs; popup lists them with a tail, shows one log, and Stop cancels without a message", async () => {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.wakeWorker = () => {};
    const a = await ctx.fns.agent.start({ model: "mock:test" });
    expect(await ctx.fns.jobs.badge({ agentId: a.id })).toBe("");
    const quick = await ctx.fns.jobs.start({ agentId: a.id, command: "echo finished-line; exit 4" });
    await until(ctx, quick.id);
    const long = await ctx.fns.jobs.start({ agentId: a.id, command: "echo started-line; sleep 30" });
    await Bun.sleep(400);
    const badge = await ctx.fns.jobs.badge({ agentId: a.id });
    expect(badge).toContain('<span class="w-badge-mark">1</span>');
    expect(badge).toContain("1 job running");
    expect(badge).toContain('hx-popup="jobs.popup"');

    const list = await text(await ctx.fns.jobs.popup({ agentId: a.id }));
    expect(list).toContain("1 running");
    expect(list).toContain("started-line");
    expect(list).toContain("exit 4");
    expect(list).toContain(`&quot;stop&quot;:&quot;${long.id}&quot;`);
    expect(await text(await ctx.fns.jobs.popup({ agentId: a.id, id: quick.id }))).toContain("finished-line");

    const stopped = await text(await ctx.fns.jobs.popup({ agentId: a.id, stop: long.id }));
    expect(stopped).toContain(`Stopped ${long.id}`);
    expect((await ctx.fns.jobs.get({ id: long.id })).status).toBe("cancelled");
    expect(await ctx.fns.jobs.badge({ agentId: a.id })).toBe("");
    // a job of another chat cannot be opened or stopped through this one
    const b = await ctx.fns.agent.start({ model: "mock:test" });
    const other = await ctx.fns.jobs.start({ agentId: b.id, command: "sleep 30" });
    expect(await text(await ctx.fns.jobs.popup({ agentId: a.id, stop: other.id }))).toContain("No job");
    expect((await ctx.fns.jobs.get({ id: other.id })).status).toBe("running");
    await ctx.fns.jobs.cancel({ id: other.id });
}, 30_000);

test("a member sees the jobs of their own chats (and its team children), not someone else's; an owner sees all", async () => {
    const ctx: any = await mkTestCtx();
    const now = Date.now();
    for (const [id, role] of [["ann", "member"], ["bob", "member"]]) {
        await ctx.fns.procs.db.run({ sql: "insert into users (id, email, name, role, created_at, updated_at) values (?, ?, ?, ?, ?, ?) on conflict do nothing", params: [id, `${id}@x`, id, role, now, now] });
    }
    const a = await ctx.fns.agent.start({ model: "mock:test" });
    const child = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET created_by = 'ann' WHERE id = ?", params: [a.id] });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET created_by = NULL, parent_id = ? WHERE id = ?", params: [a.id, child.id] });
    const ann = as(ctx, { id: "ann", role: "member" }), bob = as(ctx, { id: "bob", role: "member" }), boss = as(ctx, { id: "boss", role: "owner" });
    expect(await ann.fns.jobs.canSee({ agentId: a.id })).toBe(true);
    expect(await ann.fns.jobs.canSee({ agentId: child.id })).toBe(true);
    expect(await bob.fns.jobs.canSee({ agentId: a.id })).toBe(false);
    expect(await boss.fns.jobs.canSee({ agentId: a.id })).toBe(true);
    expect(await bob.fns.jobs.canSee({ agentId: "nope" })).toBe(false);
    expect(await text(await bob.fns.jobs.popup({ agentId: a.id }))).toContain("Not your chat");
    expect(await bob.fns.jobs.badge({ agentId: a.id })).toBe("");
});
