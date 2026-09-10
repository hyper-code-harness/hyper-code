import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function seeded(ctx: any) {
  const agent = await ctx.fns.agent.start({ model: "lmstudio:test", title: "compact test", workspaceDir: process.cwd() });
  for (let i = 0; i < 12; i++) await ctx.fns.session.appendMessage({ id: agent.id, message: { role: i % 2 ? "assistant" : "user", content: `${i}:` + "x".repeat(16000) } });
  await ctx.fns.session.syncAgentState({ agent });
  return agent;
}

describe("agent.compactContext", () => {
  test("activates summary plus verbatim tail without changing root", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    const before = await ctx.fns.session.getMessages({ id: agent.id });
    ctx.state.registry.llm.call = () => ({ text: "handoff summary", finishReason: "stop", usage: {}, raw: {} });
    const result = await ctx.fns.agent.compactContext({ agent });
    expect(result.status).toBe("compacted");
    expect(await ctx.fns.session.getMessages({ id: agent.id })).toEqual(before);
    const request = await ctx.fns.agent.buildLlmRequest({ agent });
    const summaryAt = request.messages.findIndex((m: any) => m.content === "handoff summary");
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    // The seeded transcript ends on an assistant message, so buildLlmRequest
    // closes the request with its synthetic "keep going" user turn (never
    // persisted). The verbatim tail is everything between summary and it.
    expect(request.messages.at(-1)!.role).toBe("user");
    expect(request.messages.slice(summaryAt + 1, -1).map((m: any) => m.content)).toEqual(before.slice(agent.sleepContext.generations.at(-1).tailStart).map((m: any) => m.content));
    const child = (await ctx.fns.procs.db.select({ sql: "SELECT parent_id, fork_offset, scratchpad FROM agents WHERE id = ?", params: [agent.sleepContext.generations.at(-1).contextAgentId] }) as any[])[0];
    expect(Number(child.fork_offset)).toBe(0);
    const childScratchpad = typeof child.scratchpad === "string" ? JSON.parse(child.scratchpad) : child.scratchpad;
    expect(childScratchpad.compaction.status).toBe("draft");
    expect(await ctx.fns.agent.team({ agent })).toHaveLength(0);
  });

  test("tail boundary includes an assistant tool call before its result", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "x", args: {} }] } });
    await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "tool", content: "ok", tool_call_id: "c1" } });
    await ctx.fns.session.syncAgentState({ agent });
    ctx.state.registry.llm.call = () => ({ text: "summary", finishReason: "stop", usage: {}, raw: {} });
    await ctx.fns.agent.compactContext({ agent });
    const root = await ctx.fns.session.getMessages({ id: agent.id });
    const tail = root.slice(agent.sleepContext.generations.at(-1).tailStart);
    expect(tail.some((m: any) => m.tool_calls?.[0]?.id === "c1")).toBe(true);
    expect(tail.some((m: any) => m.tool_call_id === "c1")).toBe(true);
  });

  test("marks draft stale when root changes during summarization", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    ctx.state.registry.llm.call = async () => {
      await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "concurrent" } });
      return { text: "stale summary", finishReason: "stop", usage: {}, raw: {} };
    };
    const result = await ctx.fns.agent.compactContext({ agent });
    expect(result.status).toBe("stale");
    expect(agent.sleepContext.activeRevision).toBeNull();
    expect(agent.sleepContext.generations.at(-1).status).toBe("stale");
  });

  test("repeated compaction summarizes the active effective projection and survives reload", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    const inputs: string[] = [];
    ctx.state.registry.llm.call = (_c: any, _s: any, opts: any) => {
      inputs.push(String(opts.user));
      return { text: inputs.length === 1 ? "summary one" : "summary two", finishReason: "stop", usage: {}, raw: {} };
    };
    expect((await ctx.fns.agent.compactContext({ agent })).status).toBe("compacted");
    for (let i = 0; i < 8; i++) await ctx.fns.session.appendMessage({ id: agent.id, message: { role: i % 2 ? "assistant" : "user", content: `new-${i}:` + "y".repeat(16000) } });
    await ctx.fns.session.syncAgentState({ agent });
    expect((await ctx.fns.agent.compactContext({ agent })).status).toBe("compacted");
    expect(inputs[1]).toContain("summary one");
    const loaded = await ctx.fns.session.load({ id: agent.id });
    expect(loaded!.sleepContext.activeRevision).toBe(2);
    const request = await ctx.fns.agent.buildLlmRequest({ agent: loaded! });
    expect(request.messages.some((m: any) => m.content === "summary two")).toBe(true);
  });


  test("does not send unsupported sampling parameters to the summarizer", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    let callOpts: any;
    ctx.state.registry.llm.call = (_c: any, _s: any, opts: any) => {
      callOpts = opts;
      return { text: "summary", finishReason: "stop", usage: {}, raw: {} };
    };
    await ctx.fns.agent.compactContext({ agent });
    expect(callOpts.temperature).toBeUndefined();
  });


  test("uses native server compaction for Codex and replays its opaque checkpoint", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    agent.model = "codex:gpt-test";
    await ctx.fns.session.save({ agent });
    let compactOpts: any;
    ctx.state.registry.llm.compactCodex = (_c: any, _s: any, opts: any) => {
      compactOpts = opts;
      return { item: { type: "compaction", id: "cmp", encrypted_content: "opaque" }, responseId: "resp", usage: { prompt_tokens: 10, completion_tokens: 1 } };
    };
    ctx.state.registry.llm.call = () => { throw new Error("text summarizer must not run"); };
    const result = await ctx.fns.agent.compactContext({ agent });
    expect(result.status).toBe("compacted");
    expect(compactOpts.model).toBe("codex:gpt-test");
    const generation = agent.sleepContext.generations.at(-1);
    const stored = await ctx.fns.session.getMessages({ id: generation.contextAgentId });
    expect(stored[0].message_type).toBe("codex_compaction");
    const request = await ctx.fns.agent.buildLlmRequest({ agent });
    const converted = ctx.fns.llm.toCodexInput({ messages: request.messages });
    expect(converted.input).toContainEqual({ type: "compaction", id: "cmp", encrypted_content: "opaque" });
  });


  test("summarizer failure leaves no active projection", async () => {
    const ctx = await mkTestCtx();
    const agent = await seeded(ctx);
    ctx.state.registry.llm.call = () => { throw new Error("boom"); };
    await expect(ctx.fns.agent.compactContext({ agent })).rejects.toThrow("boom");
    expect(agent.sleepContext.activeRevision).toBeNull();
    expect(agent.sleepContext.generations.at(-1).status).toBe("failed");
  });
});
