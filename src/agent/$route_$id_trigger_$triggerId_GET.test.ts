import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("trigger audit popup shows run count, latest run and error", async () => {
  const ctx: any = await mkTestCtx();
  const agent = await ctx.fns.agent.start({ model: "mock:test" });
  const made = await ctx.fns.agent.wake({ id: agent.id, inMs: 1000, prompt: "audit me" });
  await ctx.fns.agent.pollTriggers({ now: made.nextAt + 1 });
  await Bun.sleep(30);
  const response = await ctx.fns.procs.http.dispatch({ method: "GET", url: `/agent/${agent.id}/trigger/${made.id}` });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain("Trigger audit");
  expect(html).toContain("Total runs");
  expect(html).toContain("Last run");
  expect(html).toContain("fired");
  expect(html).toContain("audit me");
});
