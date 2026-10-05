import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { reqCtx } from "../$test";

test("agent search exposes per-viewer new activity without counting events", async () => {
  const ctx: any = await mkTestCtx();
  const user = await ctx.fns.auth.createUser({ name: "Reader", email: "reader@example.test", password: "password-123" });
  const scoped: any = reqCtx(ctx);
  scoped.session.user = user;
  const a = await ctx.fns.agent.start({ model: "mock:test", title: "Unread watermark test" });
  await ctx.fns.session.save({ agent: a });
  expect((await scoped.fns.agent.search({ query: a.id }))[0].hasUnread).toBe(false);
  await ctx.fns.session.appendEvent({ id: a.id, event: { type: "tool_call", name: "noop" } });
  expect((await scoped.fns.agent.search({ query: a.id }))[0].hasUnread).toBe(false);
  await ctx.fns.session.appendEvent({ id: a.id, event: { type: "assistant", text: "done" } });
  expect((await scoped.fns.agent.search({ query: a.id }))[0].hasUnread).toBe(true);
  await scoped.fns.auth.markSeen({ agentId: a.id });
  expect((await scoped.fns.agent.search({ query: a.id }))[0].hasUnread).toBe(false);
});
