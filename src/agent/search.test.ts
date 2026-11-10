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

test("agent.search pages with offset and filters by exact ids and project", async () => {
  const ctx = await mkTestCtx();
  const a = await ctx.fns.agent.start({ model: "mock:test", title: "Pagingzz alpha" });
  const b = await ctx.fns.agent.start({ model: "mock:test", title: "Pagingzz beta" });
  const all = await ctx.fns.agent.search({ query: "pagingzz", limit: 10 });
  expect(all.map((row: any) => row.id).sort()).toEqual([a.id, b.id].sort());
  const second = await ctx.fns.agent.search({ query: "pagingzz", limit: 1, offset: 1 });
  expect(second.map((row: any) => row.id)).toEqual([all[1].id]);
  expect((await ctx.fns.agent.search({ ids: [b.id], limit: 10 })).map((row: any) => row.id)).toEqual([b.id]);
  expect(await ctx.fns.agent.search({ ids: [], limit: 10 })).toEqual([]);
  const project: any = await ctx.fns.project.create({ slug: `paging${Date.now()}`, title: "Paging", defaultDir: "/tmp" });
  await ctx.fns.procs.db.run({ sql: "UPDATE agents SET project_id = ? WHERE id = ?", params: [project.id, a.id] });
  const inProject = await ctx.fns.agent.search({ query: "pagingzz", projectId: project.id, limit: 10 });
  expect(inProject.map((row: any) => row.id)).toEqual([a.id]);
});
