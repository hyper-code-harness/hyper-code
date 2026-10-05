import { describe, expect, test } from "bun:test";
import build from "./buildLlmRequest";

function ctx(provider: string): any {
    return { fns: {
        agent: {
            fullSystemPrompt: async () => "runtime instructions",
            normalizeSleepContext: () => null,
            getSleepGeneration: () => null,
        },
        session: {
            repairToolPairs: ({ messages }: any) => ({ messages, repaired: [] }),
            getMessages: async () => [], getFullMessages: async () => [],
        },
        auth: { attributeMessages: async ({ messages }: any) => ({ applied: false, messages }) },
        llm: { resolveEndpoint: async () => ({ provider }) },
        attachments: { resolveContent: async ({ messages }: any) => messages },
        procs: { log: { warn: () => {} } },
    } };
}

describe("buildLlmRequest OAuth identity", () => {
    test("managed OAuth keeps exact Claude identity in system", async () => {
        const result = await build(ctx("anthropic-oauth"), null, { agent: { model: "anthropic-oauth:claude-x", messages: [], scratchpad: {} } as any });
        expect(result.system).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
        expect(result.messages[0].content).toBe("runtime instructions");
    });

    test("API-key Anthropic keeps system-as-messages policy", async () => {
        const result = await build(ctx("anthropic"), null, { agent: { model: "anthropic:claude-x", messages: [], scratchpad: {} } as any });
        expect(result.system).toBe("");
        expect(result.messages[0].content).toBe("runtime instructions");
    });
});

describe("buildLlmRequest trailing turn", () => {
    const assistantTail = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "final answer" },
    ];

    test("never ends on a bare assistant message (no prefill)", async () => {
        const result = await build(ctx("claude-code"), null, { agent: { model: "claude-code:claude-opus-5", messages: assistantTail, scratchpad: {} } as any });
        expect(result.messages[result.messages.length - 1].role).toBe("user");
        expect(result.messages[result.messages.length - 2].content).toBe("final answer");
    });

    test("an assistant message carrying tool calls is left alone", async () => {
        const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "", tool_calls: [{ id: "t1", name: "bash" }] }];
        const result = await build(ctx("claude-code"), null, { agent: { model: "claude-code:claude-opus-5", messages, scratchpad: {} } as any });
        expect(result.messages[result.messages.length - 1].role).toBe("assistant");
    });

    test("a transcript already ending on user is untouched", async () => {
        const result = await build(ctx("anthropic"), null, { agent: { model: "anthropic:claude-x", messages: [{ role: "user", content: "hi" }], scratchpad: {} } as any });
        expect(result.messages.length).toBe(3);
    });
});

