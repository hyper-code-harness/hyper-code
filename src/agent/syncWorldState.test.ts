import { expect, test } from "bun:test";
import { testCtx } from "../$test";
import fullSystemPrompt from "./fullSystemPrompt";

// A provider prompt cache is a PREFIX match: the bootstrap turn assembled from
// fullSystemPrompt is supposed to be byte-identical for every request of a
// session and for every transcript-sharing fork (agent.cacheRoot keys on that).
// Anything volatile belongs at the tail instead, as its own transcript row.
//
// These tests pin both halves of that: the prefix does not move when the world
// does, and the world still reaches the model.

const tab = (over: Record<string, any> = {}) => ({
    bindingId: "b1", targetId: "t1", cdpSessionName: "main", state: "active",
    contextRevision: 7, url: "https://example.com/a", title: "Page A", ...over,
});

async function withTab(ctx: any, binding: any) {
    ctx.state.registry.sidebar.bindingForAgent = async () => binding;
    ctx.state.registry.plugins.siteHint = async () => "";
}

test("the system prompt does not move when the bound tab navigates", async () => {
    const ctx: any = await testCtx();
    const agent: any = { id: "ws1", model: "mock:test", systemPrompt: "", scratchpad: {}, messages: [] };

    await withTab(ctx, tab());
    const before = await fullSystemPrompt(ctx, null, { agent });
    // Same agent, new page: url, title and contextRevision all differ.
    await withTab(ctx, tab({ url: "https://example.com/b", title: "Page B", contextRevision: 8 }));
    const after = await fullSystemPrompt(ctx, null, { agent });

    // Byte-identical, or every token after it is recomputed and paid for again.
    expect(after).toBe(before);
    // And the page never leaked into the cached prefix in the first place.
    expect(before).not.toContain("example.com");
});

test("a navigation is one tail row, and only the part that changed", async () => {
    const ctx: any = await testCtx();
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "look at the page" });
    await ctx.fns.session.syncAgentState({ agent });

    await withTab(ctx, tab());
    const first = await ctx.fns.agent.syncWorldState({ agent });
    expect(first.appended).toBe(true);
    expect(first.changed).toEqual(["browser"]);

    // Nothing moved → nothing is said. An unchanged section costs no tokens,
    // which is the entire point of diffing instead of re-rendering.
    expect((await ctx.fns.agent.syncWorldState({ agent })).appended).toBe(false);

    await withTab(ctx, tab({ url: "https://example.com/b", title: "Page B", contextRevision: 8 }));
    const second = await ctx.fns.agent.syncWorldState({ agent });
    expect(second.appended).toBe(true);

    const rows = (await ctx.fns.session.getMessages({ id: agent.id }))
        .filter((message: any) => message.message_type === "world_state");
    expect(rows.length).toBe(2);
    expect(rows[0].content).toContain("https://example.com/a");
    expect(rows[1].content).toContain("https://example.com/b");
    // Append-only: the first row keeps saying what the model saw at the time,
    // so a fork or a restart reconstructs the same request.
    expect(rows[0].content).not.toContain("Page B");
    // Cursor-excluded, like the status line: it answers no user turn and must
    // not make the worker think a new message arrived.
    expect(rows.every((row: any) => row.excluded_from_cursor === true)).toBe(true);
});

test("an unbound tab is announced, so an earlier row is not read as current", async () => {
    const ctx: any = await testCtx();
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "hi" });
    await ctx.fns.session.syncAgentState({ agent });

    await withTab(ctx, tab());
    await ctx.fns.agent.syncWorldState({ agent });
    // The user closed the sidebar: the binding is gone, but the row describing
    // it is still in the transcript and would otherwise look live forever.
    await withTab(ctx, null);
    const gone = await ctx.fns.agent.syncWorldState({ agent });

    expect(gone.appended).toBe(true);
    expect(gone.changed).toEqual(["browser"]);
    const last = (await ctx.fns.session.getMessages({ id: agent.id })).at(-1);
    expect(last.content).toContain("stale");
});

test("nothing is inserted between a tool call and its result", async () => {
    const ctx: any = await testCtx();
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "read it" });
    await ctx.fns.session.appendMessage({ id: agent.id, message: {
        role: "assistant", content: "", tool_calls: [{ id: "c1", name: "read", args: { path: "x" } }],
    } });
    await ctx.fns.session.syncAgentState({ agent });

    await withTab(ctx, tab());
    // Codex and xAI send back encrypted reasoning tied to the call; a user row
    // wedged in front of the result makes the provider reject the whole request.
    const result = await ctx.fns.agent.syncWorldState({ agent });
    expect(result.appended).toBe(false);
    expect(result.reason).toBe("tool-call-boundary");
    const rows = await ctx.fns.session.getMessages({ id: agent.id });
    expect(rows.at(-1).role).toBe("assistant");
});

test("the snapshot is durable, so a restart does not repeat what was already said", async () => {
    const ctx: any = await testCtx();
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "hi" });
    await ctx.fns.session.syncAgentState({ agent });

    await withTab(ctx, tab());
    expect((await ctx.fns.agent.syncWorldState({ agent })).appended).toBe(true);

    // What a restart does: the live object is gone, the row is loaded from
    // Postgres. The snapshot has to come back with it, or the first request
    // after every restart re-sends context the transcript already carries.
    const reloaded: any = await ctx.fns.session.load({ id: agent.id });
    expect(reloaded.scratchpad.worldState.browser.url).toBe("https://example.com/a");
    expect((await ctx.fns.agent.syncWorldState({ agent: reloaded })).appended).toBe(false);
});

test("a plugin block travels in the same row, and repeats only when it changes", async () => {
    const ctx: any = await testCtx();
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "fix the login test" });
    await ctx.fns.session.syncAgentState({ agent });

    await withTab(ctx, null);
    let block = "<memory>last time: the fixture was stale</memory>";
    ctx.fns.procs.hooks.register({ name: "agent.promptAugment", id: "world-state-test", fn: () => block });

    const first = await ctx.fns.agent.syncWorldState({ agent });
    expect(first.changed).toEqual(["augment"]);
    expect((await ctx.fns.session.getMessages({ id: agent.id })).at(-1).content).toContain("fixture was stale");

    // Same answer next turn: the model already has it, so it is not paid for
    // twice. This is new — splicing into the user message re-sent it every turn.
    expect((await ctx.fns.agent.syncWorldState({ agent })).appended).toBe(false);

    block = "<memory>and the port was busy</memory>";
    const changed = await ctx.fns.agent.syncWorldState({ agent });
    expect(changed.appended).toBe(true);
    expect((await ctx.fns.session.getMessages({ id: agent.id })).at(-1).content).toContain("port was busy");
});
