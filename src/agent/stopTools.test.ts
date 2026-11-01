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

test("Stop during a tool call ends the run: no further calls, no model call after the press", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    agent.scratchpad.mockLLM = { turns: [
        { toolCalls: [
            { name: "bash", args: { command: "echo working; sleep 30" } },
            { name: "bash", args: { command: "echo second" } },
        ] },
        { text: "reply written after stop" },
    ], defaultText: "reply written after stop" };
    await ctx.fns.session.save({ agent });

    const started = Date.now();
    const run = ctx.fns.agent.run({ agent, userText: "go" }).then(() => null, (e: any) => e);
    await until(() => ctx.fns.tools.runs({ agentId: agent.id }), (l: any[]) => l.length === 1 && String(l[0].tail).includes("working"));
    await ctx.fns.agent.stop({ agent });
    const error = await run;

    expect(error?.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const msgs = await ctx.fns.session.getMessages({ id: agent.id });
    // (the memory hook may add world-state user rows before the turn; the turn itself is the tail)
    const tail = msgs.slice(-3);
    expect(tail.map((m: any) => m.role)).toEqual(["assistant", "tool", "tool"]);
    expect(String(tail[1].content)).toContain("stopped by the user");
    expect(String(tail[2].content)).toContain("not run — stopped by the user");
    expect(msgs.some((m: any) => String(m.content).includes("reply written after stop"))).toBe(false);
}, 30_000);
