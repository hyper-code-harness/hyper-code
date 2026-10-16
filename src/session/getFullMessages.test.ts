import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

function agent(id: string, messages: any[], extra: any = {}) {
  return {
    id, model: "m", systemPrompt: "", scratchpad: {}, messages, events: [], cursors: {}, subscribers: new Set<(ev: any, signal?: AbortSignal) => void>(), waiters: [], isStreaming: false, abortController: null,
    parentId: extra.parentId ?? null,
    forkOffset: extra.forkOffset ?? null,
  };
}

// Fixtures explicitly import own rows; inherited prefixes are assembled only on read.
async function seedHistory(ctx: any, { agent }: { agent: any }) {
  await ctx.fns.session.save({ agent });
  await ctx.fns.session.replaceMessages({ id: agent.id, messages: agent.messages });
}

describe("session.getFullMessages", () => {
  test("chains parent messages for child", async () => {
    const ctx: any = await mkTestCtx();
    await seedHistory(ctx, { agent: agent("parent", [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }, { role: "user", content: "What is 2+2?" }]) });
    await seedHistory(ctx, { agent: agent("child", [{ role: "user", content: "Child question" }, { role: "assistant", content: "Child answer" }], { parentId: "parent", forkOffset: 3 }) });
    const full = await ctx.fns.session.getFullMessages({ id: "child" });
    expect(full.length).toBe(5);
    expect(full[0].content).toBe("Hello");
    expect(full[2].content).toBe("What is 2+2?");
    expect(full[3].content).toBe("Child question");
    expect(full[4].content).toBe("Child answer");
  });

  test("respects offset for mid-conversation fork", async () => {
    const ctx: any = await mkTestCtx();
    await seedHistory(ctx, { agent: agent("parent", [
      { role: "user", content: "msg1" },
      { role: "user", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "user", content: "msg4" },
    ]) });
    await seedHistory(ctx, { agent: agent("child", [{ role: "user", content: "child msg" }], { parentId: "parent", forkOffset: 2 }) });
    const full = await ctx.fns.session.getFullMessages({ id: "child" });
    expect(full.length).toBe(3);
    expect(full[0].content).toBe("msg1");
    expect(full[1].content).toBe("msg2");
    expect(full[2].content).toBe("child msg");
  });

  test("chains grandparent -> parent -> child", async () => {
    const ctx: any = await mkTestCtx();
    await seedHistory(ctx, { agent: agent("gp", [{ role: "user", content: "gp msg" }]) });
    await seedHistory(ctx, { agent: agent("parent", [{ role: "user", content: "parent msg" }], { parentId: "gp", forkOffset: 1 }) });
    await seedHistory(ctx, { agent: agent("child", [{ role: "user", content: "child msg" }], { parentId: "parent", forkOffset: 2 }) });
    const full = await ctx.fns.session.getFullMessages({ id: "child" });
    expect(full.length).toBe(3);
    expect(full[0].content).toBe("gp msg");
    expect(full[1].content).toBe("parent msg");
    expect(full[2].content).toBe("child msg");
  });

  test("getMessages returns only own messages", async () => {
    const ctx: any = await mkTestCtx();
    await seedHistory(ctx, { agent: agent("parent", [{ role: "user", content: "parent msg" }]) });
    await seedHistory(ctx, { agent: agent("child", [{ role: "user", content: "child msg" }], { parentId: "parent", forkOffset: 1 }) });
    const own = await ctx.fns.session.getMessages({ id: "child" });
    expect(own.length).toBe(1);
    expect(own[0].content).toBe("child msg");
  });
});
