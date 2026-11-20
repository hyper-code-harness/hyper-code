import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import delegateTask from "./delegateTask";
import finishTask from "./finishTask";
import buildDelegatedTaskPrompt from "./buildDelegatedTaskPrompt";

async function setup() {
    const ctx = await mkTestCtx();
    ctx.fns.agent.delegateTask = delegateTask;
    ctx.fns.agent.finishTask = finishTask;
    ctx.fns.agent.buildDelegatedTaskPrompt = buildDelegatedTaskPrompt;
    ctx.fns.agent.run = async (c: any, _s: any, opts: { agent: any; userText: string }) => {
        const child = opts.agent;
        child.scratchpad.__lastPrompt = opts.userText;
        await c.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        return c.fns.agent.finishTask({ agent: child, summary: "done", result: { ok: true, inherited: !!child.parentId } });
    };
    return ctx;
}

describe("agent.delegateTask", () => {
    test("forkContext true links child to parent transcript context", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "user", content: "parent msg" } });
        const res = await delegateTask(ctx, null, { parent, task: "check", forkContext: true, responseFormat: "json", autoArchive: false });
        const child = ctx.state.agent[res.childId];
        expect(child.parentId).toBe(parent.id);
        expect((await ctx.fns.session.getFullMessages({ id: child.id }))[0].content).toBe("parent msg");
    });

    test("forkContext false creates isolated child", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "user", content: "parent msg" } });
        const res = await delegateTask(ctx, null, { parent, task: "check", forkContext: false, autoArchive: false });
        const child = ctx.state.agent[res.childId];
        expect(child.parentId).toBeNull();
        expect((await ctx.fns.session.getFullMessages({ id: child.id })).map((m: any) => m.content)).not.toContain("parent msg");
        expect(child.scratchpad.delegateTask.parentId).toBe(parent.id);
    });

    test("await mode returns childId summary and result", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        const res = await delegateTask(ctx, null, { parent, task: "do it", responseFormat: "json" });
        expect(res).toEqual({ childId: res.childId, summary: "done", result: { ok: true, inherited: false } });
    });

    test("stores task metadata in child scratchpad", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        const res = await delegateTask(ctx, null, { parent, task: "lint files", instructions: "be strict", responseFormat: { kind: "report", fields: ["files", "issues"] }, autoArchive: false });
        const child = ctx.state.agent[res.childId];
        expect(child.scratchpad.delegateTask).toMatchObject({
            parentId: parent.id,
            mode: "await",
            forkContext: false,
            task: "lint files",
            instructions: "be strict",
            status: "finished",
        });
    });

    test("throws if child completes without finishTask", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        ctx.fns.agent.run = async () => ({ ok: true });
        await expect(delegateTask(ctx, null, { parent, task: "bad child" })).rejects.toThrow("delegateTask: child completed without finishTask");
    });

    test("builds wrapped delegated prompt", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        const res = await delegateTask(ctx, null, { parent, task: "inspect repo", instructions: "only source files", responseFormat: "report", autoArchive: false });
        const child = ctx.state.agent[res.childId];
        expect(child.scratchpad.__lastPrompt).toContain("You are executing a delegated task for a parent agent.");
        expect(child.scratchpad.__lastPrompt).toContain("inspect repo");
        expect(child.scratchpad.__lastPrompt).toContain("only source files");
        expect(child.scratchpad.__lastPrompt).toContain("finishTask");
    });
    test("archives a completed child by default", async () => {
        const ctx = await setup();
        const parent = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: parent });
        const res = await delegateTask(ctx, null, { parent, task: "research", responseFormat: "json" });
        expect((await ctx.fns.session.list()).some((a: any) => a.id === res.childId)).toBe(false);
        expect((await ctx.fns.session.list({ includeArchived: true })).find((a: any) => a.id === res.childId)?.archivedAt).not.toBeNull();
    });
    for (const forkContext of [false, true]) {
        for (const mode of ["await", "async"] as const) {
            test(`${mode} forkContext=${forkContext} applies and persists child settings before run`, async () => {
                const ctx = await setup();
                const parent = await ctx.fns.agent.start({ model: "mock:parent" });
                parent.reasoningEffort = "xhigh";
                await ctx.fns.session.save({ agent: parent });
                const seen: Array<{ model: string; reasoningEffort: string | undefined }> = [];
                let running: Promise<unknown> | undefined;
                ctx.fns.agent.run = (c: any, _s: any, opts: { agent: any }) => running = (async () => {
                    const row = (await c.fns.procs.db.select({ sql: "SELECT model,reasoning_effort FROM agents WHERE id=?", params: [opts.agent.id] }))[0];
                    expect(row.model).toBe(opts.agent.model);
                    expect(row.reasoning_effort).toBe(opts.agent.reasoningEffort);
                    seen.push({ model: opts.agent.model, reasoningEffort: opts.agent.reasoningEffort });
                    return c.fns.agent.finishTask({ agent: opts.agent, summary: "ok", result: { ok: true } });
                })();
                for (const [settings, expected] of [
                    [{}, { model: "mock:parent", reasoningEffort: "xhigh" }],
                    [{ model: "mock:reviewer" }, { model: "mock:reviewer", reasoningEffort: "xhigh" }],
                    [{ reasoningEffort: "auto" as const }, { model: "mock:parent", reasoningEffort: "auto" }],
                    [{ model: "mock:reviewer", reasoningEffort: "off" as const }, { model: "mock:reviewer", reasoningEffort: "off" }],
                ] as const) {
                    const res = await delegateTask(ctx, null, { parent, task: "review", forkContext, mode, autoArchive: false, ...settings });
                    // Join the actual stubbed run, so async failures cannot hide in logging.
                    await running;
                    expect(ctx.state.agent[res.childId].scratchpad.delegateTask.status).toBe("finished");
                    expect(await ctx.fns.session.load({ id: res.childId })).toMatchObject(expected);
                    expect(seen.at(-1)).toEqual(expected);
                }
                expect(await ctx.fns.session.load({ id: parent.id })).toMatchObject({ model: "mock:parent", reasoningEffort: "xhigh" });
            });
        }
        test(`forkContext=${forkContext} rejects invalid settings without a child or run`, async () => {
            const ctx = await setup();
            const parent = await ctx.fns.agent.start({ model: "mock:parent" });
            const before = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents ORDER BY id" });
            let runs = 0;
            ctx.fns.agent.run = async () => { runs++; };
            for (const [settings, error] of [
                [{ model: "missing-delegation-provider:test" }, "cannot resolve model"],
                [{ model: "" }, "model must be a non-empty"],
                [{ reasoningEffort: "huge" }, "invalid reasoningEffort"],
            ] as const) {
                await expect(delegateTask(ctx, null, { parent, task: "bad", forkContext, mode: "async", ...settings } as any)).rejects.toThrow(error);
                expect(await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents ORDER BY id" })).toEqual(before);
            }
            expect(runs).toBe(0);
        });
    }

});
