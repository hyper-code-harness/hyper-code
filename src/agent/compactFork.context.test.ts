import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// A fork sees its parent's history up to fork_offset plus its own rows. Every
// compaction offset must count that same history: compaction used to count only
// the fork's own rows while buildLlmRequest sliced the full history with the
// same number, so the request started mid-parent on an orphan tool result and
// Anthropic answered 400 on every retry.

const big = (s: string) => s + " " + "x".repeat(16000);

async function parentWithTools(ctx: any) {
  const parent = await ctx.fns.agent.start({ model: "lmstudio:test", title: "parent", workspaceDir: process.cwd() });
  for (let i = 0; i < 10; i++) {
    await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "user", content: big(`parent fact ${i}`) } });
    await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "assistant", content: "", tool_calls: [{ id: `p${i}`, name: "bash", args: {} }] } });
    await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "tool", content: big(`parent result ${i}`), tool_call_id: `p${i}` } });
    await ctx.fns.session.appendMessage({ id: parent.id, message: { role: "assistant", content: big(`parent answer ${i}`) } });
  }
  await ctx.fns.session.syncAgentState({ agent: parent });
  return parent;
}

async function forkWithOwn(ctx: any, parent: any, n: number) {
  const fork = await ctx.fns.session.fork({ id: parent.id, title: "fork" });
  for (let i = 0; i < n; i++) {
    await ctx.fns.session.appendMessage({ id: fork.id, message: { role: "user", content: big(`fork ask ${i}`) } });
    await ctx.fns.session.appendMessage({ id: fork.id, message: { role: "assistant", content: "", tool_calls: [{ id: `f${i}`, name: "read", args: {} }] } });
    await ctx.fns.session.appendMessage({ id: fork.id, message: { role: "tool", content: big(`fork result ${i}`), tool_call_id: `f${i}` } });
    await ctx.fns.session.appendMessage({ id: fork.id, message: { role: "assistant", content: big(`fork answer ${i}`) } });
  }
  await ctx.fns.session.syncAgentState({ agent: fork });
  return fork;
}

/** Every tool result in the request follows the assistant message that called it. */
function orphans(messages: any[]) {
  const open = new Set<string>();
  const bad: string[] = [];
  for (const m of messages) {
    if (m.role === "tool") { if (!open.delete(String(m.tool_call_id))) bad.push(String(m.tool_call_id)); }
    for (const c of m.tool_calls ?? []) open.add(String(c.id));
  }
  return bad;
}

describe("fork compaction coordinates", () => {
  test("compacting a fork summarises the parent part and the request keeps a clean tail", async () => {
    const ctx = await mkTestCtx();
    const parent = await parentWithTools(ctx);
    const fork = await forkWithOwn(ctx, parent, 6);
    let summarised = "";
    ctx.state.registry.llm.call = (_c: any, _s: any, opts: any) => { summarised = String(opts.user); return { text: "fork summary", finishReason: "stop", usage: {}, raw: {} }; };

    const result = await ctx.fns.agent.compactContext({ agent: fork });
    expect(result.status).toBe("compacted");
    const generation = fork.sleepContext.generations.at(-1);
    expect(generation.basis).toBe("context");
    expect(generation.inherited).toBe(40);
    // The tail is counted in the fork's context history: past the 40 inherited rows.
    expect(generation.tailStart).toBeGreaterThan(40);
    expect(summarised).toContain("parent fact 0");

    const request = await ctx.fns.agent.buildLlmRequest({ agent: fork });
    const at = request.messages.findIndex((m: any) => String(m.content).endsWith("fork summary"));
    expect(at).toBeGreaterThan(0);
    // Nothing of the parent is replayed after the summary: it is inside it.
    expect(request.messages.slice(at + 1).some((m: any) => String(m.content).includes("parent"))).toBe(false);
    const history = (await ctx.fns.agent.contextHistory({ id: fork.id })).messages;
    expect(request.messages.slice(at + 1, request.messages.at(-1)!.role === "user" && history.at(-1)!.role === "assistant" ? -1 : undefined).map((m: any) => m.content))
      .toEqual(history.slice(generation.tailStart).map((m: any) => m.content));
    expect(orphans(request.messages)).toEqual([]);
    expect(request.messages[at + 1].role).not.toBe("tool");
  });

  test("auto-compaction of a long fork produces a request without orphan tool results", async () => {
    const ctx = await mkTestCtx();
    const parent = await parentWithTools(ctx);
    const fork = await forkWithOwn(ctx, parent, 8);
    ctx.state.registry.llm.call = () => ({ text: "auto summary", finishReason: "stop", usage: {}, raw: {} });
    const result = await ctx.fns.agent.autoCompactIfNeeded({ agent: fork, thresholdTokens: 10_000 });
    expect(result.status).toBe("compacted");
    const request = await ctx.fns.agent.buildLlmRequest({ agent: fork });
    const at = request.messages.findIndex((m: any) => String(m.content).endsWith("auto summary"));
    expect(at).toBeGreaterThan(0);
    expect(request.messages.slice(at + 1).some((m: any) => String(m.content).includes("parent"))).toBe(false);
    expect(request.messages.slice(at + 1).some((m: any) => String(m.content).includes("fork answer 7"))).toBe(true);
    expect(orphans(request.messages)).toEqual([]);
  });

  test("a legacy fork generation is projected safely and replaced by auto-compaction", async () => {
    const ctx = await mkTestCtx();
    const parent = await parentWithTools(ctx);
    const fork = await forkWithOwn(ctx, parent, 6);
    // What the old code stored for this fork: tailStart counted over own rows only
    // (own row 6 = fork tool result 1), summary of own rows only.
    const child = await ctx.fns.agent.start({ model: fork.model, title: "old compact", parentId: fork.id, forkOffset: 0, visibility: "hidden" });
    await ctx.fns.session.appendMessage({ id: child.id, message: { role: "user", content: "old own-only summary", message_type: "compaction_summary" } });
    const legacy = { mode: "compact", activeRevision: 1, draftRevision: null, draftOwner: null, generations: [{ revision: 1, kind: "compaction", status: "active", contextAgentId: child.id, sourceAgentId: fork.id, sourceOffset: 24, sourceFrontier: 24, tailStart: 6, model: fork.model, activatedAt: Date.now() }] };
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ?", params: [JSON.stringify(legacy), fork.id] });
    fork.sleepContext = legacy;

    // The old slice was history.slice(6): mid-parent, opening on parent tool result p1.
    const history = (await ctx.fns.agent.contextHistory({ id: fork.id })).messages;
    expect(history[6].role).toBe("tool");
    const before = await ctx.fns.agent.buildLlmRequest({ agent: fork });
    expect(orphans(before.messages)).toEqual([]);
    // Legacy projection: the parent prefix stays verbatim, then the old summary, then the own tail.
    expect(before.messages.some((m: any) => String(m.content).includes("parent fact 0"))).toBe(true);

    ctx.state.registry.llm.call = () => ({ text: "fresh full summary", finishReason: "stop", usage: {}, raw: {} });
    const result = await ctx.fns.agent.autoCompactIfNeeded({ agent: fork, thresholdTokens: 10_000_000 });
    expect(result.status).toBe("compacted");
    expect(fork.sleepContext.generations.at(-1).basis).toBe("context");
    const after = await ctx.fns.agent.buildLlmRequest({ agent: fork });
    expect(after.messages.some((m: any) => String(m.content).endsWith("fresh full summary"))).toBe(true);
    expect(after.messages.some((m: any) => String(m.content).includes("old own-only summary"))).toBe(false);
    expect(orphans(after.messages)).toEqual([]);
  });

  test("root chat compaction keeps own-row coordinates", async () => {
    const ctx = await mkTestCtx();
    const root = await parentWithTools(ctx);
    ctx.state.registry.llm.call = () => ({ text: "root summary", finishReason: "stop", usage: {}, raw: {} });
    expect((await ctx.fns.agent.compactContext({ agent: root })).status).toBe("compacted");
    const generation = root.sleepContext.generations.at(-1);
    expect(generation.inherited).toBe(0);
    expect(generation.sourceOffset).toBe(40);
    const request = await ctx.fns.agent.buildLlmRequest({ agent: root });
    expect(orphans(request.messages)).toEqual([]);
  });
});
