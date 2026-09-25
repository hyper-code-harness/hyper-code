import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent durable triggers", () => {
  test("wake fires once into the same conversation", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const made = await ctx.fns.agent.wake({ id: agent.id, inMs: 1000, prompt: "Continue later" });
    expect(made.id).toStartWith("tr_");
    await ctx.fns.agent.pollTriggers({ now: made.nextAt + 1 });
    await Bun.sleep(30);
    const rows = await ctx.fns.agent.triggers({ id: agent.id, status: "all" });
    expect(rows[0].status).toBe("completed");
    const messages = await ctx.fns.session.getMessages({ id: agent.id });
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "Continue later", message_type: "trigger", excluded_from_cursor: true });
  });

  test("cron advances and cancelAll cancels active triggers", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const made = await ctx.fns.agent.cron({ id: agent.id, expression: "* * * * *", timezone: "UTC", prompt: "Tick" });
    await ctx.fns.agent.pollTriggers({ now: made.nextAt + 1 });
    await Bun.sleep(30);
    const active = await ctx.fns.agent.triggers({ id: agent.id });
    expect(Number(active[0].nextAt)).toBeGreaterThan(made.nextAt);
    expect((await ctx.fns.agent.cancelAllTriggers({ id: agent.id })).cancelled).toBe(1);
  });

  test("edge watch fires only on false-to-true transitions", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const marker = `.hyper-test-${crypto.randomUUID()}`;
    const made = await ctx.fns.agent.watch({ id: agent.id, predicate: "file.exists", opts: { path: marker }, prompt: "File ready", everyMs: 5000, mode: "edge" });
    await ctx.fns.agent.pollTriggers({ now: made.nextAt }); await Bun.sleep(30);
    await ctx.fns.files.write({ path: marker, content: "ok" });
    let row = (await ctx.fns.agent.triggers({ id: agent.id }))[0];
    await ctx.fns.agent.pollTriggers({ now: Number(row.nextAt) + 1 }); await Bun.sleep(30);
    let messages = await ctx.fns.session.getMessages({ id: agent.id });
    expect(messages.filter((m: any) => m.content === "File ready")).toHaveLength(1);
    row = (await ctx.fns.agent.triggers({ id: agent.id }))[0];
    await ctx.fns.agent.pollTriggers({ now: Number(row.nextAt) + 1 }); await Bun.sleep(30);
    messages = await ctx.fns.session.getMessages({ id: agent.id });
    expect(messages.filter((m: any) => m.content === "File ready")).toHaveLength(1);
    await ctx.fns.files.remove({ path: marker });
  });

  test("cancel prevents delivery", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const made = await ctx.fns.agent.wake({ id: agent.id, inMs: 1000, prompt: "Never" });
    expect((await ctx.fns.agent.cancelTrigger({ id: agent.id, triggerId: made.id })).cancelled).toBe(true);
    await ctx.fns.agent.pollTriggers({ now: made.nextAt + 1 }); await Bun.sleep(20);
    expect((await ctx.fns.session.getMessages({ id: agent.id })).some((m: any) => m.content === "Never")).toBe(false);
  });
});
