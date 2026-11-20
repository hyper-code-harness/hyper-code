import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("delegation settings preflight", () => {
    test("validates inherited routes too, without creating a child", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "no-such-provider:parent" });
        const before = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents ORDER BY id" });
        for (const call of [
            () => ctx.fns.agent.delegate({ agent: parent, title: "Review", tasks: [{ id: "review", title: "Review" }] }),
            () => ctx.fns.agent.delegateTask({ parent, task: "Review", mode: "async" }),
        ]) {
            await expect(call()).rejects.toThrow('cannot resolve model "no-such-provider:parent"');
            expect(await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents ORDER BY id" })).toEqual(before);
        }
    });

    test("trims routes before validating and storing either kind of delegated child", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:parent" });
        ctx.fns.agent.wakeWorker = () => {};
        ctx.fns.agent.run = async () => {};
        const child = await ctx.fns.agent.delegate({ agent: parent, title: "Review", tasks: [{ id: "review", title: "Review" }], model: " mock:reviewer " });
        const task = await ctx.fns.agent.delegateTask({ parent, task: "Review", mode: "async", model: " mock:reviewer " });
        for (const id of [child.id, task.childId]) {
            const stored = await ctx.fns.session.load({ id });
            expect(stored?.model).toBe("mock:reviewer");
            expect(await ctx.fns.llm.resolveEndpoint({ model: stored!.model })).toMatchObject({ provider: "mock" });
        }
        expect(await ctx.fns.agent.resolveDelegationSettings({ parent: { ...parent, model: " mock:parent " } })).toMatchObject({ model: "mock:parent" });
    });

    test("keeps every requested effort even when the model cannot apply it", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:parent" });
        for (const reasoningEffort of ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const) {
            expect(await ctx.fns.agent.resolveDelegationSettings({ parent, model: "mock:reviewer", reasoningEffort })).toEqual({ model: "mock:reviewer", reasoningEffort });
        }
    });

    test("accepts resolver-supported routes without catalogue membership or inference", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:parent" });
        let resolved = 0;
        ctx.fns.llm.resolveEndpoint = async (_c: any, _s: any, opts: { model: string }) => {
            expect(opts.model).toBe("hyper/reviewer:custom-model");
            const rows = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents" });
            expect(rows).toHaveLength(1); // resolver runs before any fork/start
            resolved++;
            return { url: "http://test", apiKey: null, modelId: "custom-model", provider: "hyper", account: "reviewer", kind: "api", api: "responses" };
        };
        ctx.fns.llm.listModels = async () => { throw new Error("no catalogue gate"); };
        ctx.fns.llm.call = async () => { throw new Error("no paid inference preflight"); };
        ctx.fns.agent.wakeWorker = () => {};
        const child = await ctx.fns.agent.delegate({ agent: parent, title: "Review", tasks: [{ id: "review", title: "Review" }], model: "hyper/reviewer:custom-model", reasoningEffort: "high" });
        expect(resolved).toBe(1);
        expect(await ctx.fns.session.load({ id: child.id })).toMatchObject({ model: "hyper/reviewer:custom-model", reasoningEffort: "high" });
    });

    test("legacy parents without a preference default to auto", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:parent" });
        delete parent.reasoningEffort;
        expect(await ctx.fns.agent.resolveDelegationSettings({ parent })).toEqual({ model: "mock:parent", reasoningEffort: "auto" });
    });

    test("preserves the endpoint failure cause with a route-specific error", async () => {
        const ctx = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "mock:parent" });
        const cause = new Error("node unavailable");
        ctx.fns.llm.resolveEndpoint = async () => { throw cause; };
        const error = await ctx.fns.agent.resolveDelegationSettings({ parent }).catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('delegation: cannot resolve model "mock:parent": node unavailable');
        expect((error as Error).cause).toBe(cause);
    });
});
