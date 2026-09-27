import { describe, expect, test } from "bun:test";
import run from "./run";
import acceptMessage from "./acceptMessage";

function harness() {
    const rows: any[] = [{ idx: 0, role: "user", content: "first" }];
    const events: any[] = [];
    const agent: any = { id: "a", model: "mock:test", title: "a", workspaceDir: process.cwd(), systemPrompt: "", messages: [...rows], events, scratchpad: {}, isStreaming: true, abortController: null, samplingAbortController: null };
    let streamCalls = 0;
    const ctx: any = { state: { agent: { a: agent } }, fns: {
        session: {
            forAgent: () => null,
            appendMessage: async ({ message }: any) => { const row = { ...message, idx: rows.length }; rows.push(row); return row; },
            appendUserMessage: async ({ text }: any) => { const row = { role: "user", content: text, idx: rows.length }; rows.push(row); return row; },
            appendEvent: async ({ event }: any) => events.push(event), appendAssistantEvent: async () => {}, appendErrorEvent: async () => {},
            syncAgentState: async ({ agent }: any) => { agent.messages = rows.map(row => ({ ...row })); return agent; },
            getFullMessages: async () => rows, getMessages: async () => rows,
        },
        procs: { db: { select: async ({ sql }: any) => sql.includes("MAX(idx)") ? [{ i: Math.max(...rows.filter(r => r.role === "user" && !r.excluded_from_cursor).map(r => r.idx), -1) }] : [{ id: "a" }], run: async () => ({ changes: 1 }) }, ui: { escape: ({ text }: any) => text }, log: { warn: () => {} } },
        settings: { getNumber: async () => 0 }, attachments: { saveUploads: async () => [], commitUploads: async () => {}, resolveContent: async ({ messages }: any) => messages },
        agent: { renderEventHtml: async () => "", wakeWorker: () => {}, statusLineForTurn: async () => "", buildLlmRequest: async () => ({ system: "", messages: agent.messages }), functionRag: async () => null, fullSystemPrompt: async () => "", cacheRoot: async () => "a", wireTools: () => [], stashResult: async ({ output }: any) => output },
        llm: { stream: async ({ signal }: any) => { streamCalls++; if (streamCalls === 1) return await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })); return { text: "steered answer", usage: {}, finishReason: "stop", toolCalls: [] }; } },
        markdown: { render: async ({ source }: any) => source }, tools: { call: async () => ({ output: "" }) }, events: { refreshAgentMeta: () => {} },
    } };
    return { ctx, agent, rows, get streamCalls() { return streamCalls; } };
}

describe("instant steering", () => {
    test("HTTP input aborts active sampling and the same run resamples with fresh history", async () => {
        const h = harness();
        const running = run(h.ctx, null, { agent: h.agent, userText: "", userMessageAlreadyAppended: true });
        while (!h.agent.samplingAbortController) await Bun.sleep(1);
        const response = await acceptMessage(h.ctx, null, { req: new Request("http://localhost/agent/a?debounceSeconds=0", { method: "POST", body: "change direction" }), params: { id: "a" } });
        expect(response.status).toBe(200);
        const result = await running;
        expect(h.streamCalls).toBe(2);
        expect(h.rows.some(row => row.role === "user" && row.content === "change direction")).toBe(true);
        expect(h.rows.some(row => row.role === "assistant" && row.content === "steered answer")).toBe(true);
        expect(result.consumedUserIdx).toBe(1);
    });
});
