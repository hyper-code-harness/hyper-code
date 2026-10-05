import { expect, test } from "bun:test";
import { testCtx } from "../$test";
import build from "./buildLlmRequest";

const ctx = await testCtx();
const setHits = (hits: any[]) => { (ctx.state.registry as any).runtime.docs.search = async () => hits; };
const relevant = [
    { name: "telegram.send", summary: "Send Telegram message", signature: "({ chat, text }) => unknown", score: 0.032, bm25: 12, similarity: 0.52, evidence: "intersection" },
    { name: "telegram.messages", summary: "List Telegram messages", signature: "({ chat }) => unknown", score: 0.029, bm25: 8, similarity: 0.44, evidence: "intersection" },
];

test("function RAG is disabled by default and enabled agents retrieve functions", async () => {
    setHits(relevant);
    const messages = [{ role: "user", content: "wait until a condition becomes true then resume the agent", idx: 4 }];
    expect(await ctx.fns.agent.functionRag({ agent: { functionRagEnabled: false } as any, messages })).toBeNull();
    const rag = await ctx.fns.agent.functionRag({ agent: { functionRagEnabled: true } as any, messages });
    expect(rag?.messageIdx).toBe(4);
    expect(rag?.functions.length).toBeGreaterThan(0);
    expect(rag?.functions.every((item: any) => item.name && item.signature)).toBe(true);
});

test("retrieved candidates travel as a world_state row, not by rewriting the user's message", async () => {
    setHits(relevant);
    const agent: any = await ctx.fns.agent.start({ model: "mock:test" });
    agent.functionRagEnabled = true;
    await ctx.fns.session.appendUserMessage({ id: agent.id, text: "send a telegram message" });
    await ctx.fns.session.syncAgentState({ agent });

    const first = await ctx.fns.agent.syncWorldState({ agent });
    expect(first.appended).toBe(true);
    expect(first.changed).toContain("functions");

    const messages = await ctx.fns.session.getMessages({ id: agent.id });
    // The user's own words are left exactly as written — the catalogue is a row
    // of its own, so the transcript shows what the model actually saw.
    expect(messages[0].content).toBe("send a telegram message");
    const row = messages.findLast((message: any) => message.message_type === "world_state");
    expect(row.content).toContain("<relevant_runtime_functions>");
    expect(row.content).toContain("telegram.send");
    // Cursor-excluded, like the status line: it answers no user turn.
    expect(row.excluded_from_cursor).toBe(true);

    // The same catalogue for the same turn is not sent twice: an unchanged
    // section costs nothing, which is the whole point of the diff.
    const again = await ctx.fns.agent.syncWorldState({ agent });
    expect(again.appended).toBe(false);
    expect(again.reason).toBe("unchanged");
    const after = await ctx.fns.session.getMessages({ id: agent.id });
    expect(after.filter((message: any) => message.message_type === "world_state").length).toBe(1);
});

test("buildLlmRequest no longer rewrites history for retrieval", async () => {
    setHits(relevant);
    const agent: any = {
        id: "rag", model: "mock:test", systemPrompt: "", scratchpad: {}, functionRagEnabled: true,
        messages: [{ role: "user", content: "send a telegram message", idx: 0 }],
    };
    const result = await build(ctx, null, { agent });
    const outgoing = result.messages.findLast((message: any) => message.role === "user");
    expect(outgoing.content).toBe("send a telegram message");
    expect(agent.messages[0].content).toBe("send a telegram message");
});

test("function RAG reports empty retrieval without injecting candidates", async () => {
    setHits([]);
    const rag = await ctx.fns.agent.functionRag({
        agent: { functionRagEnabled: true } as any,
        messages: [{ role: "user", content: "thanks, continue", idx: 2 }],
    });
    expect(rag?.functions).toEqual([]);
    expect(rag?.retrieved).toBe(0);
});



test("function RAG indicator renders at the end of a user bubble", async () => {
    const html = await ctx.fns.agent.renderEventHtml({
        agentId: "a", event: { type: "user", text: "hello", messageIdx: 1, functionRag: { functions: ["telegram.send", "agent.wakeAt"] } },
    });
    expect(html).toContain("Function RAG: retrieved");
    expect(html).toContain("role=\"tooltip\"");
    expect(html).toContain("telegram.send");
    expect(html).toContain("agent.wakeAt");
    expect(html.indexOf("hello")).toBeLessThan(html.indexOf("Function RAG: retrieved"));
});
