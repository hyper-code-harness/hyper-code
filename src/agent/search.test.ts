import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("agent.search ranks title prefixes, supports ordered terms and hides compaction agents", async () => {
  const ctx = await mkTestCtx();
  const prefix = await ctx.fns.agent.start({ model: "mock:test", title: "Hypermesh network" });
  const middle = await ctx.fns.agent.start({ model: "mock:test", title: "Old hypermesh network notes" });
  const hidden = await ctx.fns.agent.start({ model: "mock:test", title: "Hypermesh · compact", visibility: "hidden" });
  const prefixHits = await ctx.fns.agent.search({ query: "hypermesh", limit: 10 });
  expect(prefixHits.findIndex((row: any) => row.id === prefix.id)).toBeLessThan(prefixHits.findIndex((row: any) => row.id === middle.id));
  expect(prefixHits.some((row: any) => row.id === hidden.id)).toBe(false);
  const ordered = await ctx.fns.agent.search({ query: "old network", limit: 10 });
  expect(ordered.some((row: any) => row.id === middle.id)).toBe(true);
  const fuzzy = await ctx.fns.agent.search({ query: "hyprmesh", limit: 10 });
  expect(fuzzy.some((row: any) => row.id === prefix.id)).toBe(true);
});
