import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("ui.createAgent persists initial and failed-run events through session APIs", async () => {
    const ctx: any = await mkTestCtx();
    let started!: () => void, fail!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const unblock = new Promise<void>(resolve => { fail = resolve; });
    ctx.state.registry.agent.run = async () => { started(); await unblock; throw new Error("test failure"); };
    const created = await ctx.fns.ui.createAgent({ model: "m", open: false, startText: "hello" });
    await running;
    expect((await ctx.fns.session.getEvents({ id: created.id }))[0]).toMatchObject({ type: "user", text: "hello" });
    fail();
    // Wait for the queued run's finally, with a bounded deadline (no real LLM).
    const deadline = Date.now() + 2000;
    while (ctx.state.agent[created.id].isStreaming && Date.now() < deadline) await Bun.sleep(5);
    expect(ctx.state.agent[created.id].isStreaming).toBe(false);
    expect((await ctx.fns.session.getEvents({ id: created.id }))[1]).toMatchObject({ type: "error", error: "test failure" });
});
