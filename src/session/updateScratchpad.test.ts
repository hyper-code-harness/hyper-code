import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.updateScratchpad", () => {
  test("updates scratchpad without touching messages/events", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "m", systemPrompt: "" });
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "hello" } });
    await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "user", text: "hello" } });
    await ctx.fns.session.updateScratchpad({ id: agent.id, scratchpad: { x: 1 } });
    const loaded = (await ctx.fns.session.load({ id: agent.id }))!;
    expect(loaded.scratchpad).toEqual({ x: 1 });
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.events).toHaveLength(1);
  });
});
