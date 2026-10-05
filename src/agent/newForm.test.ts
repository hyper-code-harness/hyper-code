import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("new form ignores an unusable last model and selects configured default", async () => {
  const ctx: any = await mkTestCtx();
  await ctx.fns.procs.db.run({ sql: "INSERT INTO kv(key,value) VALUES('last-model','openai:missing') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value" });
  ctx.fns.llm.listModels = async () => ({ "hyper/macstudio": ["hyper/macstudio:claude-sonnet-4-6"] });
  ctx.fns.settings.modelDefault = async () => "hyper/macstudio:claude-sonnet-4-6";
  const html = await ctx.fns.agent.newForm({});
  expect(html).not.toContain("openai:missing");
  expect(html).toContain('value="hyper/macstudio:claude-sonnet-4-6" selected');
});
