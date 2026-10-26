// The chat's background-jobs button and modal: the button counts running jobs and hides when the chat never had
// one; the modal lists jobs, a row opens one job with its full log, Stop cancels it, and another chat cannot.
import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("jobs button and modal", () => {
    test("list → one job with its log → stop; the button follows", async () => {
        const ctx: any = await mkTestCtx();
        ctx.state.registry.agent.wakeWorker = () => {};
        const a = await ctx.fns.agent.start({ model: "mock:test" });
        expect(await ctx.fns.jobs.buttonHtml({ agentId: a.id })).not.toContain("hx-popup");

        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "echo line-one; echo line-two; sleep 30" });
        const button = await ctx.fns.jobs.buttonHtml({ agentId: a.id });
        expect(button).toContain('hx-popup="jobs.panel"');
        expect(button).toContain("1 background job running");
        expect(button).toContain(`data-live-topic="agent:${a.id}"`);

        const list = await (await ctx.fns.jobs.panel({ agentId: a.id })).text();
        expect(list).toContain("1 running");
        expect(list).toContain(`&quot;id&quot;:&quot;${job.id}&quot;`);
        expect(list).toContain('data-popup-kind="jobs"');

        let one = "";
        for (let i = 0; i < 30 && !one.includes("line-two"); i++) { await Bun.sleep(100); one = await (await ctx.fns.jobs.panel({ agentId: a.id, id: job.id })).text(); }
        expect(one).toContain("line-one");
        expect(one).toContain("line-two");
        expect(one).toContain("All jobs");
        expect(one).toContain("Stop");

        // another chat can neither see nor stop it
        const b = await ctx.fns.agent.start({ model: "mock:test" });
        expect(await (await ctx.fns.jobs.panel({ agentId: b.id, cancel: job.id })).text()).toContain("not this chat");
        expect((await ctx.fns.jobs.get({ id: job.id })).status).toBe("running");

        const stopped = await (await ctx.fns.jobs.panel({ agentId: a.id, cancel: job.id })).text();
        expect(stopped).toContain("cancelled");
        expect(stopped).not.toContain(">Stop<");
        expect((await ctx.fns.jobs.get({ id: job.id })).status).toBe("cancelled");
        const after = await ctx.fns.jobs.buttonHtml({ agentId: a.id });
        expect(after).toContain('hx-popup="jobs.panel"');
        expect(after).not.toContain("running");
    });
});
