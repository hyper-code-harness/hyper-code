// agent.stop ends the agent's running tool calls but leaves its background jobs alone.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx: any = await testCtx();

async function until<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < end) { await Bun.sleep(20); v = await fn(); }
    return v;
}

test("Stop aborts the agent's running bash call; its background job keeps running", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const other = await ctx.fns.agent.start({ model: "mock:test" });
    const job = await ctx.fns.jobs.start({ agentId: agent.id, command: "sleep 20", title: "bg sleep" });
    const started = Date.now();
    const call = ctx.fns.tools.call({ name: "bash", args: { command: "echo working; sleep 30" }, agent });
    const theirs = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 30" }, agent: other });
    const runs = await until(() => ctx.fns.tools.runs({ agentId: agent.id }), (l: any[]) => l.length === 1 && String(l[0].tail).includes("working"));
    expect(runs.length).toBe(1);

    await ctx.fns.agent.stop({ agent });
    const result = await call;
    expect(result.output).toContain("stopped by the user");
    expect(result.output).toContain("working");
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(ctx.fns.tools.runs({ agentId: agent.id }).length).toBe(0);

    // another agent's call is not touched
    expect(ctx.fns.tools.runs({ agentId: other.id }).length).toBe(1);
    // the background job is not a call: still running
    const rows = await ctx.fns.jobs.list({ agentId: agent.id, status: "all" });
    expect(rows.find((j: any) => j.id === job.id)?.status).toBe("running");

    for (const r of ctx.fns.tools.runs({ agentId: other.id })) ctx.fns.tools.abortRun({ id: r.id });
    await theirs;
    await ctx.fns.jobs.cancel({ id: job.id });
}, 30_000);
