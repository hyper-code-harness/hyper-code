import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import delegate from "./delegate";
import team from "./team";
import steer from "./steer";
import ask from "./ask";
import done from "../session/done";
import renderMeta from "../ui/agentMetaPanel";
import archiveMember from "./archiveMember";
import unarchiveMember from "./unarchiveMember";
import archiveCompleted from "./archiveCompleted";
import stopMember from "./stopMember";
import retryMember from "./retryMember";

async function setup() {
    const ctx = await mkTestCtx();
    ctx.fns.agent.delegate = delegate;
    ctx.fns.agent.team = team;
    ctx.fns.agent.steer = steer;
    ctx.fns.agent.ask = ask;
    ctx.fns.session.done = done;
    ctx.fns.agent.wakeWorker = () => {};
    return ctx;
}

describe("team delegation", () => {
    test("delegate forks a child and assigns the native session plan", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", title: "Parent" });
        ctx.fns.agent.run = async () => { throw new Error("durable delegate must not run inline"); };
        const member = await delegate(ctx, null, {
            agent: parent,
            title: "Research",
            tasks: [
                { id: "inspect", title: "Inspect sources" },
                { id: "report", title: "Report findings" },
            ],
        });
        const child = ctx.state.agent[member.id];
        expect(child.parentId).toBe(parent.id);
        expect(child.forkOffset).toBe(0);
        expect(child.scratchpad.plan.tasks.map((task: any) => task.status)).toEqual(["active", "pending"]);
        const members = await team(ctx, null, { agent: parent });
        expect(members[0]).toMatchObject({ id: child.id, status: "working" });
        expect(members[0]!.plan.tasks).toHaveLength(2);
    });

    test("completing a child task steers one durable update and schedules idle parent", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, title: "Child" });
        child.scratchpad.delegation = { parentId: parent.id, status: "working" };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await ctx.fns.session.plan({ agent: child, title: "Work", tasks: [
            { id: "one", title: "First" }, { id: "two", title: "Second" },
        ] });
        await done(ctx, null, { agent: child, id: "one" });
        await done(ctx, null, { agent: child, id: "one" });
        const messages = await ctx.fns.session.getMessages({ id: parent.id, includeExcluded: true });
        expect(messages.filter((m: any) => m.message_type === "team_update")).toHaveLength(1);
        expect(messages.find((m: any) => m.message_type === "team_update")?.excluded_from_cursor).toBeUndefined();
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [parent.id] }) as any[])[0];
        expect(Number(row.next_run_at)).toBeGreaterThan(0);
    });

    test("ask rejects agents outside the direct team", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const stranger = await ctx.fns.agent.start({ model: "m" });
        await expect(ask(ctx, null, { agent: parent, member: stranger.id, question: "details?" })).rejects.toThrow("not a direct child");
    });

    test("finishTask requires result and stores it on the final completed task", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, title: "Child", offset: 0 });
        child.scratchpad = { delegation: { parentId: parent.id, status: "working" } };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await ctx.fns.session.plan({ agent: child, title: "Work", tasks: [{ id: "final", title: "Final" }] });
        await done(ctx, null, { agent: child, id: "final" });
        const finishTask = (await import("./finishTask")).default;
        await expect(finishTask(ctx, null, { agent: child, summary: "done" } as any)).rejects.toThrow("result is required");
        await finishTask(ctx, null, { agent: child, summary: "done", result: { findings: ["x"] } });
        expect(child.scratchpad.plan.tasks[0].result).toEqual({ findings: ["x"] });
        expect(child.scratchpad.plan.tasks[0].resultSummary).toBe("done");
    });

    test("steer schedules a parent even when it is already running", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, offset: 0 });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'running', next_run_at = NULL WHERE id = ?", params: [parent.id] });
        await steer(ctx, null, { from: child, event: "task.completed", summary: "ready" });
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [parent.id] }) as any[])[0];
        expect(Number(row.next_run_at)).toBeGreaterThan(0);
    });


    test("finishTask is one-shot and does not duplicate final steering", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, offset: 0 });
        child.scratchpad = { delegation: { parentId: parent.id, status: "working" } };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await ctx.fns.session.plan({ agent: child, title: "Work", tasks: [{ id: "final", title: "Final" }] });
        await done(ctx, null, { agent: child, id: "final" });
        const finishTask = (await import("./finishTask")).default;
        await finishTask(ctx, null, { agent: child, summary: "first", result: { value: 1 } });
        await finishTask(ctx, null, { agent: child, summary: "second", result: { value: 2 } });
        expect(child.scratchpad.plan.tasks[0].result).toEqual({ value: 1 });
        const updates = (await ctx.fns.session.getMessages({ id: parent.id, includeExcluded: true }))
            .filter((m: any) => m.message_type === "team_update" && String(m.content).includes('event="plan.completed"'));
        expect(updates).toHaveLength(1);
    });


    test("stops and durably retries a delegated member", async () => {
        const ctx = await setup();
        ctx.fns.agent.stopMember = stopMember;
        ctx.fns.agent.retryMember = retryMember;
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, offset: 0 });
        child.scratchpad = { delegation: { parentId: parent.id, status: "working" } };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await ctx.fns.session.plan({ agent: child, title: "Work", tasks: [{ id: "one", title: "One" }] });
        await stopMember(ctx, null, { agent: parent, member: child.id });
        expect(child.scratchpad.delegation.status).toBe("blocked");
        expect(child.scratchpad.plan.pausedAt).not.toBeNull();
        await retryMember(ctx, null, { agent: parent, member: child.id });
        const reloaded = await ctx.fns.session.load({ id: child.id });
        expect(reloaded!.scratchpad.delegation.status).toBe("working");
        expect(reloaded!.scratchpad.plan.pausedAt).toBeNull();
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [child.id] }) as any[])[0];
        expect(Number(row.next_run_at)).toBeGreaterThan(0);
    });


    test("refuses to archive a working or running member", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, offset: 0 });
        child.scratchpad = { delegation: { parentId: parent.id, status: "working" } };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await expect(archiveMember(ctx, null, { agent: parent, member: child.id })).rejects.toThrow("cannot archive a working member");
        child.scratchpad.delegation.status = "ready";
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'running' WHERE id = ?", params: [child.id] });
        await expect(archiveMember(ctx, null, { agent: parent, member: child.id })).rejects.toThrow("cannot archive a working member");
    });


    test("archives, filters, restores, and timeout-cleans ready members", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m" });
        const child = await ctx.fns.session.fork({ id: parent.id, offset: 0, visibility: "team" });
        child.scratchpad = { delegation: { parentId: parent.id, status: "ready", summary: "done" } };
        await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        expect((await team(ctx, null, { agent: parent })).map((m: any) => m.id)).toContain(child.id);
        await archiveMember(ctx, null, { agent: parent, member: child.id });
        expect(await team(ctx, null, { agent: parent })).toHaveLength(0);
        expect((await team(ctx, null, { agent: parent, includeArchived: true }))[0]!.archivedAt).not.toBeNull();
        await unarchiveMember(ctx, null, { agent: parent, member: child.id });
        expect(await team(ctx, null, { agent: parent })).toHaveLength(1);
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET updated_at = 1 WHERE id = ?", params: [child.id] });
        expect((await archiveCompleted(ctx, null, { olderThanMs: 0 })).archived).toContain(child.id);
    });


    test("parent Meta panel renders child plans in Team", async () => {
        // the real UI helpers (button, toggle, sections…), not hand stubs that fall behind them
        const ctx: any = await mkTestCtx({ db: false });
        const html = await renderMeta(ctx, null, {
            agent: { id: "p", scratchpad: {}, goal: null } as any,
            archivedTeam: [{ id: "z", title: "Old research", runState: "idle", status: "ready", summary: "Archived result", updatedAt: 1, archivedAt: 2, plan: { tasks: [] } }],
            team: [{ id: "c", title: "Research", runState: "running", status: "working", summary: null, updatedAt: 1, plan: { tasks: [
                { id: "a", title: "Inspect", status: "done" },
                { id: "b", title: "Compare", status: "active" },
            ] } }],
        });
        expect(html).toContain("Team");
        expect(html).toContain("Research");
        expect(html).toContain("Inspect");
        expect(html).toContain("Compare");
        expect(html).toContain('/agent/c');
        expect(html).toContain("Show archived (1)");
        expect(html).toContain("Old research");
        expect(html).toContain("/unarchive");
        expect(html).toContain("Restore &amp; open");
        expect(html).toContain("/stop");
    });
});
