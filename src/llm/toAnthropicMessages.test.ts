import { test, expect, describe } from "bun:test";
import convert from "./toAnthropicMessages";

const ctx = {} as Context;

describe("llm.toAnthropicMessages", () => {
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
