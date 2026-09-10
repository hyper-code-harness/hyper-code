import { describe, expect, test } from "bun:test";
import compactCodex from "./compactCodex";

const jwt = () => `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url")}.x`;
const sse = (events: any[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("llm.compactCodex", () => {
    test("sends compaction trigger and returns the encrypted checkpoint", async () => {
        let request: any;
        const ctx: any = { fns: { llm: {
            resolveEndpoint: async () => ({ provider: "codex", account: "default", modelId: "gpt-test", apiKey: null, url: "https://chatgpt.test/responses" }),
            refreshCodex: async () => jwt(), codexCliVersion: async () => "1.0.0",
            toCodexInput: () => ({ instructions: "", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }] }),
            connectFetch: async (opts: any) => { request = opts; return sse([
                { type: "response.output_item.done", item: { type: "compaction", id: "cmp", encrypted_content: "opaque" } },
                { type: "response.completed", response: { id: "resp", usage: { input_tokens: 10, output_tokens: 2 } } },
            ]); },
            parseSSE: async function* ({ body }: any) { const text = await new Response(body).text(); for (const frame of text.trim().split("\n\n")) yield { event: null, data: frame.slice(6) }; },
        } } };
        const result = await compactCodex(ctx, null, { model: "codex:gpt-test", sessionId: "aa", instructions: "system", messages: [] });
        const body = JSON.parse(request.init.body);
        expect(body.input.at(-1)).toEqual({ type: "compaction_trigger" });
        expect(JSON.parse(body.client_metadata["x-codex-turn-metadata"])).toMatchObject({ request_kind: "compaction" });
        expect(result).toMatchObject({ item: { type: "compaction", encrypted_content: "opaque" }, responseId: "resp", usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
});
