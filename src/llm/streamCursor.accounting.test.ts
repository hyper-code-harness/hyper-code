import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Agent } from "@cursor/sdk";
import streamCursor from "./streamCursor";

const restore: Array<() => void> = [];
afterEach(() => { for (const undo of restore.splice(0)) undo(); });

function fixture(events: any[], result: any, streamError?: Error) {
    const records: any[] = [];
    const run = {
        stream: async function* () { for (const event of events) yield event; if (streamError) throw streamError; },
        wait: async () => result,
        cancel: async () => {},
    };
    const create = spyOn(Agent, "create").mockResolvedValue({ agentId: "offline-sdk-agent", send: async () => run, close: () => {} } as any);
    const remove = spyOn(Agent, "delete").mockResolvedValue(undefined);
    restore.push(() => create.mockRestore(), () => remove.mockRestore());
    const ctx: any = { env: { HOME: "/offline-not-written" }, fns: {
        llm: {
            resolveEndpoint: async () => ({ provider: "cursor", account: "work", modelId: "model", apiKey: "offline-token" }),
            toCursorPrompt: () => "private prompt",
        },
        agent: { buildLlmRequest: async () => ({ system: "private instructions", messages: [] }), wireTools: () => [] },
        files: { mkdir: async () => {} },
        llmUsage: { recordResult: async (opts: any) => { records.push(opts); } },
    } };
    return { ctx, records, agent: { id: "owner", model: "cursor/work:model", scratchpad: {} } as any };
}

describe("Cursor usage accounting", () => {
    test("records final aggregate once rather than adding it to streamed per-turn usage", async () => {
        const usage = { inputTokens: 7, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2, totalTokens: 17 };
        const { ctx, records, agent } = fixture([{ type: "usage", usage }, { type: "usage", usage }], { status: "completed", usage: { ...usage, inputTokens: 14 }, result: "ok" });
        const result = await streamCursor(ctx, null, { agent });
        expect(result.text).toBe("ok");
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ provider: "cursor", account: "work", model: "model", api: "sdk", status: "success",
            usage: { inputTokens: 14, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 } });
        expect(JSON.stringify(records)).not.toContain("private");
        expect(JSON.stringify(records)).not.toContain("offline-token");
    });

    test("missing provider usage stays unknown, not the legacy zero-filled UI shape", async () => {
        const { ctx, records, agent } = fixture([], { status: "completed", result: "ok" });
        await streamCursor(ctx, null, { agent });
        expect(records).toHaveLength(1);
        expect(records[0].usage).toBeUndefined();
        expect(records[0].status).toBe("success");
    });

    test("keeps known per-turn counts on stream failure without copying errors", async () => {
        const { ctx, records, agent } = fixture([{ type: "usage", usage: { inputTokens: 4, outputTokens: 0 } }], {}, new Error("private provider diagnostic"));
        await expect(streamCursor(ctx, null, { agent })).rejects.toThrow("private provider diagnostic");
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ status: "error", usage: { inputTokens: 4, outputTokens: 0 } });
        expect(records[0].usage.cacheReadTokens).toBeUndefined();
        expect(JSON.stringify(records)).not.toContain("diagnostic");
    });

    test("user cancellation records one cancelled attempt", async () => {
        const { ctx, records, agent } = fixture([], { status: "cancelled" });
        const ac = new AbortController();
        ac.abort();
        await streamCursor(ctx, null, { agent, signal: ac.signal });
        expect(records).toHaveLength(1);
        expect(records[0].status).toBe("cancelled");
    });
});
