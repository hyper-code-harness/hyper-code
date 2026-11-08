import { test, expect, describe } from "bun:test";
import convert from "./toAnthropicMessages";
import buildLlmRequest from "../agent/buildLlmRequest";
import streamAnthropic from "./streamAnthropic";

const ctx = {} as Context;

describe("llm.toAnthropicMessages", () => {
    test("cache boundary survives appended turns without absorbing transient guidance", () => {
        const base = [{ role: "user", content: "task" }];
        const control = { role: "user", content: "request-only guidance" };
        const first = convert(ctx, null, { messages: [...base, control], cacheableMessageCount: base.length });
        expect(first[0].content).toEqual([
            { type: "text", text: "task", cache_control: { type: "ephemeral" } },
            { type: "text", text: "request-only guidance" },
        ]);
        const history = [...base,
            { role: "assistant", tool_calls: [{ id: "t1", name: "read", args: {} }] },
            { role: "tool", tool_call_id: "t1", content: "result" },
        ];
        const next = convert(ctx, null, { messages: [...history, control], cacheableMessageCount: history.length });
        expect(next[0].content[0].text).toBe(first[0].content[0].text);
        expect(next.at(-1).content).toEqual([
            { type: "tool_result", tool_use_id: "t1", content: "result", cache_control: { type: "ephemeral" } },
            { type: "text", text: "request-only guidance" },
        ]);
        expect(history.at(-1)).not.toHaveProperty("cache_control");
    });

    test("user/assistant text round-trip", () => {
        expect(convert(ctx, null, { messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
        ] })).toEqual([
            { role: "user", content: [{ type: "text", text: "hi" }] },
            { role: "assistant", content: [{ type: "text", text: "hello" }] },
        ]);
    });

    test("system messages are dropped (caller passes them as top-level 'system')", () => {
        expect(convert(ctx, null, { messages: [
            { role: "system", content: "sp" },
            { role: "user", content: "hi" },
        ] })).toEqual([
            { role: "user", content: [{ type: "text", text: "hi" }] },
        ]);
    });

    test("markers content (§eval, §result:eval) is just text — no special handling", () => {
        expect(convert(ctx, null, { messages: [
            { role: "assistant", content: "§eval\nconsole.log(1);" },
            { role: "user", content: "§result:eval\n1" },
        ] })).toEqual([
            { role: "assistant", content: [{ type: "text", text: "§eval\nconsole.log(1);" }] },
            { role: "user",      content: [{ type: "text", text: "§result:eval\n1" }] },
        ]);
    });

    // Anthropic 400s on empty text blocks ("text content blocks must be
    // non-empty"). A null / "" / whitespace content row (e.g. a reentrant
    // run() that appended undefined userText) must never reach the wire.
    test("drops null-content message (the bx[79] poison row)", () => {
        expect(convert(ctx, null, { messages: [
            { role: "assistant", content: "ask" },
            { role: "user", content: null },     // NULL-content user row
            { role: "assistant", content: "answer" },
        ] })).toEqual([
            // null dropped → two assistants coalesce into one
            { role: "assistant", content: [{ type: "text", text: "ask\n\nanswer" }] },
        ]);
    });

    test("drops empty-string and whitespace-only content (then coalesces the now-adjacent users)", () => {
        expect(convert(ctx, null, { messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "" },
            { role: "assistant", content: "   \n  " },
            { role: "user", content: "again" },
        ] })).toEqual([
            // both empty assistants dropped → the two users become adjacent → coalesced
            { role: "user", content: [{ type: "text", text: "hi\n\nagain" }] },
        ]);
    });

    test("coalesces consecutive same-role messages (keeps roles alternating after drops)", () => {
        expect(convert(ctx, null, { messages: [
            { role: "user", content: "a" },
            { role: "user", content: "b" },
            { role: "assistant", content: "c" },
        ] })).toEqual([
            { role: "user", content: [{ type: "text", text: "a\n\nb" }] },
            { role: "assistant", content: [{ type: "text", text: "c" }] },
        ]);
    });

    test("INVARIANT: never emits an empty text block, whatever the input", () => {
        const out = convert(ctx, null, { messages: [
            { role: "user" },                     // missing content
            { role: "user", content: undefined },
            { role: "assistant", content: null },
            { role: "user", content: "" },
            { role: "assistant", content: "real" },
            { role: "system", content: "" },
        ] });
        for (const m of out) {
            for (const block of m.content) {
                expect(block.text.length).toBeGreaterThan(0);
            }
        }
    });
});

test("keeps only the newest twenty images in screenshot-heavy histories", () => {
    const image = (n: number) => ({ role: "tool", tool_call_id: `c${n}`, content: [{ type: "image", mimeType: "image/png", data: `image-${n}` }] });
    const out = convert(ctx, null, { messages: Array.from({ length: 22 }, (_, n) => image(n)) });
    const blocks = out.flatMap(message => message.content);
    const images = blocks.filter(block => block.type === "image");
    expect(images).toHaveLength(20);
    expect(images[0].source.data).toBe("image-2");
    expect(blocks.some(block => block.type === "tool_result" && String(block.content).includes("earlier image"))).toBe(true);
});


test("final assistant content is trimmed (anthropic rejects trailing whitespace)", () => {
    const out = convert({} as any, null, { messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "\u00a7eval\nconsole.log(1)\n" },
    ] });
    const last = out[out.length - 1]!;
    expect(last.role).toBe("assistant");
    expect(last.content[0]!.text).toBe("\u00a7eval\nconsole.log(1)");
});

// Real builder + converter + streamer; only external dependencies are stubbed.
test("stream caches history before the actual Continue nudge across sequential requests", async () => {
    const bodies: any[] = [];
    const requests: any[] = [];
    const agent = { id: "cache-test", model: "anthropic:test", messages: [
        { role: "user", content: "task" },
        { role: "assistant", content: "first answer" },
    ] } as any;
    const context = { fns: {
        agent: {
            fullSystemPrompt: async () => "stable instructions",
            contextProjection: async ({ rootMessages }: any) => ({ messages: rootMessages }),
            buildLlmRequest: async (opts: any) => {
                const request = await buildLlmRequest(context as any, null, opts);
                requests.push(request);
                return request;
            },
            wireTools: () => [],
        },
        session: { repairToolPairs: ({ messages }: any) => ({ messages, repaired: [], dropped: [] }) },
        auth: { attributeMessages: async ({ messages }: any) => ({ messages, applied: false }) },
        attachments: { resolveContent: async ({ messages }: any) => messages },
        llm: {
            resolveEndpoint: async () => ({ provider: "anthropic", modelId: "test", url: "https://unused.invalid" }),
            resolveReasoningEffort: async () => ({ mode: "none" }),
            toAnthropicMessages: (opts: any) => convert(context as any, null, opts),
            connectFetch: async ({ init }: any) => {
                bodies.push(JSON.parse(init.body));
                return new Response("");
            },
            parseSSE: async function* () {},
        },
    } };
    await streamAnthropic(context as any, null, { agent });
    const first = bodies[0].messages;
    const nudge = "Continue from where you stopped: if the previous answer already settled the user's request, say so briefly; otherwise take the next step.";
    expect(requests[0].messages.at(-1).content).toBe(nudge);
    expect(first.at(-1).content).toEqual([{ type: "text", text: nudge }]);
    expect(requests[0].cacheableMessageCount).toBe(4);
    expect(first.at(-2).content.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(first[1].content.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(agent.messages).toHaveLength(2);

    agent.messages.push({ role: "user", content: "next task" }, { role: "assistant", content: "second answer" });
    await streamAnthropic(context as any, null, { agent });
    const second = bodies[1].messages;
    // Breakpoints move; the serialized content of the old cached prefix must not.
    const withoutMarkers = (rows: any[]) => rows.map(row => ({ ...row, content: row.content.map(({ cache_control, ...block }: any) => block) }));
    expect(withoutMarkers(second.slice(0, first.length - 1))).toEqual(withoutMarkers(first.slice(0, -1)));
    expect(requests[1].cacheableMessageCount).toBe(6);
    expect(second.at(-2).content.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(second.at(-1).content).toEqual([{ type: "text", text: nudge }]);
    expect(agent.messages).toHaveLength(4);
});
