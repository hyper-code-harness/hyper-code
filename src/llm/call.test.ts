import { describe, expect, test } from "bun:test";
import call from "./call";

describe("llm.call", () => {
    test("uses the configured default model when model is omitted", async () => {
        let resolved = "";
        const ctx: any = { fns: {
            settings: { modelDefault: async () => "mock:test" },
            llm: { resolveEndpoint: async ({ model }: any) => { resolved = model; return { api: "mock", provider: "mock", modelId: "test", url: "mock://local", apiKey: null }; } },
        } };
        const result = await call(ctx, null, { user: "hello" });
        expect(resolved).toBe("mock:test");
        expect(result.text).toBe("hello");
    });

    test("normalizes fenced structured JSON from providers without native schema support", async () => {
        const ctx: any = { fns: {
            settings: { modelDefault: async () => "mock:test" },
            llm: { resolveEndpoint: async () => ({ api: "mock", provider: "mock", modelId: "test", url: "mock://local", apiKey: null }) },
        } };
        const format = { type: "json_schema", json_schema: { schema: { type: "object", required: ["ok"], additionalProperties: false, properties: { ok: { type: "boolean" } } } } };
        const result = await call(ctx, null, { user: "```json\n{\"ok\":true}\n```", response_format: format });
        expect(result.text).toBe('{"ok":true}');
    });
    test("never sends temperature to Codex Responses", async () => {
        const previousFetch = globalThis.fetch;
        let request: any;
        globalThis.fetch = (async (_url: any, init: any) => {
            request = JSON.parse(init.body);
            return new Response('data: {"type":"response.completed","response":{"status":"completed","output_text":"ok"}}\n\ndata: [DONE]\n\n', { status: 200 });
        }) as any;
        try {
            const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "a" } })).toString("base64url")}.x`;
            const ctx: any = { fns: { settings: { modelDefault: async () => "codex:test" }, llm: {
                resolveEndpoint: async () => ({ api: "responses", provider: "codex", modelId: "test", url: "https://example.test", apiKey: token, account: "a" }),
                refreshCodex: async () => token,
            } } };
            await call(ctx, null, { user: "hello", temperature: 0 });
            expect(request.temperature).toBeUndefined();
        } finally { globalThis.fetch = previousFetch; }
    });

    test("retries OpenAI-compatible requests without unsupported temperature", async () => {
        const previousFetch = globalThis.fetch;
        const requests: any[] = [];
        globalThis.fetch = (async (_url: any, init: any) => {
            requests.push(JSON.parse(init.body));
            if (requests.length === 1) return new Response('{"detail":"Unsupported parameter: temperature"}', { status: 400 });
            return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
        }) as any;
        try {
            const ctx: any = { fns: { settings: { modelDefault: async () => "openai:test" }, llm: {
                resolveEndpoint: async () => ({ api: "openai", provider: "openai", modelId: "test", url: "https://example.test", apiKey: "key" }),
            } } };
            const result = await call(ctx, null, { user: "hello", temperature: 0 });
            expect(result.text).toBe("ok");
            expect(requests).toHaveLength(2);
            expect(requests[0].temperature).toBe(0);
            expect(requests[1].temperature).toBeUndefined();
        } finally { globalThis.fetch = previousFetch; }
    });


    test("uses xAI OAuth and Responses fields for non-agent calls", async () => {
        const previousFetch = globalThis.fetch;
        let request: any; let headers: Headers; let recorded: any;
        globalThis.fetch = (async (_url: any, init: any) => {
            request = JSON.parse(init.body); headers = new Headers(init.headers);
            return new Response('data: {"type":"response.completed","response":{"status":"completed","output_text":"ok"}}\n\ndata: [DONE]\n\n', { status: 200, headers: { "x-ratelimit-limit-tokens": "1000", "x-ratelimit-remaining-tokens": "900" } });
        }) as any;
        try {
            const ctx: any = { fns: { settings: { modelDefault: async () => "xai:grok-4.6" }, llm: {
                resolveEndpoint: async () => ({ api: "responses", provider: "xai", modelId: "grok-4.6", url: "https://api.x.ai/v1/responses", apiKey: null, account: "default" }),
                getXaiOAuthToken: async () => "xai-token",
                recordUsage: async () => null,
                refreshUsage: async (opts: any) => { recorded = opts; },
            } } };
            const result = await call(ctx, null, { user: "hello", model: "xai:grok-4.6", sessionId: "s1" });
            expect(result.text).toBe("ok");
            expect(headers!.get("authorization")).toBe("Bearer xai-token");
            expect(headers!.get("session_id")).toBe("s1");
            expect(request).toMatchObject({ model: "grok-4.6", store: false, stream: true, include: ["reasoning.encrypted_content"] });
            expect(request.text).toBeUndefined();
            expect(recorded.provider).toBe("xai");
            expect(recorded.account).toBe("default");
            expect(recorded.maxAgeMs).toBe(60_000);
        } finally { globalThis.fetch = previousFetch; }

    });

    test("retries the same model before falling back", async () => {
        const previousFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            if (calls < 3) return new Response('{"error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529 });
            return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
        }) as any;
        try {
            const ctx: any = { fns: {
                settings: { modelDefault: async () => "openai:primary", getString: async () => "openai:fallback" },
                llm: { resolveEndpoint: async ({ model }: any) => ({ api: "openai", provider: "openai", modelId: model, url: "https://example.test", apiKey: "key", kind: "api" }) },
            } };
            const result = await call(ctx, null, { user: "hello" });
            expect(result.text).toBe("ok");
            expect(result.model).toBe("openai:primary");
            expect(result.fallback?.attempts).toEqual([{ model: "openai:primary", count: 3 }]);
        } finally { globalThis.fetch = previousFetch; }
    });

    for (const provider of ["claude-code", "anthropic-oauth", "anthropic"]) {
        for (const system of [undefined, "Return only the requested word."]) {
            test(`${provider} preserves non-tool options and usage (system=${!!system})`, async () => {
                const previousFetch = globalThis.fetch;
                const requests: any[] = [];
                const resolved: string[] = [];
                const raw = { content: [{ type: "text", text: "OK" }], stop_reason: "max_tokens", usage: { input_tokens: 12, output_tokens: 2, cache_read_input_tokens: 5 } };
                globalThis.fetch = (async (_url: any, init: any) => {
                    requests.push({ body: JSON.parse(init.body), headers: init.headers });
                    return Response.json(raw);
                }) as any;
                try {
                    const ctx: any = { env: {}, fns: { llm: {
                        resolveEndpoint: async ({ model }: any) => {
                            resolved.push(model);
                            return { api: "anthropic", provider, modelId: "claude-opus-4-6", url: "https://example.test", apiKey: "api-key", account: "work" };
                        },
                        refreshClaudeCode: async ({ account }: any) => { expect(account).toBe("work"); return "cli-token"; },
                        getAnthropicOAuthToken: async ({ account }: any) => { expect(account).toBe("work"); return "oauth-token"; },
                        claudeCodeCliVersion: async () => "2.1.260",
                    } } };
                    const model = `${provider}/work:claude-opus-4-6`;
                    const result = await call(ctx, null, { user: "Reply OK", system, model, noFallback: true, max_tokens: 23, temperature: 0.2 });
                    expect(resolved).toEqual([model]);
                    expect(result).toEqual({ text: "OK", finishReason: "max_tokens", usage: raw.usage, raw, model });
                    const { body, headers } = requests[0];
                    expect(requests).toHaveLength(1);
                    expect(body.messages).toEqual([{ role: "user", content: "Reply OK" }]);
                    expect(body).toMatchObject({ model: "claude-opus-4-6", max_tokens: 23, temperature: 0.2 });
                    expect(body.tools).toBeUndefined();
                    expect(body.stream).toBeUndefined();
                    if (provider === "anthropic") {
                        expect(body.system).toBe(system);
                        expect(headers["x-api-key"]).toBe("api-key");
                    } else {
                        expect(body.system).toEqual([
                            { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
                            ...(system ? [{ type: "text", text: system }] : []),
                        ]);
                        expect(headers.authorization).toBe(`Bearer ${provider === "claude-code" ? "cli-token" : "oauth-token"}`);
                    }
                } finally { globalThis.fetch = previousFetch; }
            });
        }
    }

    test("Claude noFallback retains provider errors and never switches route or model", async () => {
        const previousFetch = globalThis.fetch;
        const resolved: string[] = [];
        globalThis.fetch = (async () => new Response('{"error":{"message":"limited"}}', { status: 429 })) as any;
        try {
            const ctx: any = { env: {}, fns: { llm: {
                resolveEndpoint: async ({ model }: any) => { resolved.push(model); return { api: "anthropic", provider: "claude-code", modelId: "claude-fable-5-1", url: "https://example.test", account: "default" }; },
                refreshClaudeCode: async () => "cli-token",
                claudeCodeCliVersion: async () => "2.1.260",
            } } };
            await expect(call(ctx, null, { user: "hello", model: "claude-code:claude-fable-5-1", noFallback: true })).rejects.toThrow('claude-code 429: {"error":{"message":"limited"}}');
            expect(resolved.length).toBeGreaterThan(0);
            expect(resolved.every(model => model === "claude-code:claude-fable-5-1")).toBe(true);
        } finally { globalThis.fetch = previousFetch; }
    });

    test("Claude route falls back to the same model on managed OAuth before another model", async () => {
        const previousFetch = globalThis.fetch;
        const resolved: string[] = [];
        globalThis.fetch = (async (_url: any, init: any) => {
            const auth = String(init.headers.authorization ?? "");
            if (auth.includes("cli")) return new Response('{"error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529 });
            return Response.json({ content: [{ type: "text", text: "oauth ok" }], stop_reason: "end_turn" });
        }) as any;
        try {
            const ctx: any = { env: {}, fns: {
                settings: { modelDefault: async () => "claude-code:test", getString: async () => "codex:fallback" },
                llm: {
                    resolveEndpoint: async ({ model }: any) => { resolved.push(model); return { api: "anthropic", provider: model.startsWith("claude-code") ? "claude-code" : "anthropic-oauth", modelId: "test", url: "https://example.test", apiKey: null, account: "default", kind: "subscription" }; },
                    refreshClaudeCode: async () => "cli-token",
                    getAnthropicOAuthToken: async () => "oauth-token",
                    claudeCodeCliVersion: async () => "2.1.260",
                },
            } };
            const result = await call(ctx, null, { user: "hello" });
            expect(result.text).toBe("oauth ok");
            expect(result.model).toBe("anthropic-oauth:test");
            expect(resolved).toEqual(["claude-code:test", "claude-code:test", "claude-code:test", "anthropic-oauth:test"]);
        } finally { globalThis.fetch = previousFetch; }
    });

});


for (const api of ['anthropic','openai','responses']) test(`deadline aborts ${api} HTTP without orphan retry`, async()=>{
 const previous=globalThis.fetch; let calls=0,aborted=false;
 globalThis.fetch=(async(_url:any,init:any)=>{calls++;return await new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>{aborted=true;reject(init.signal.reason);},{once:true});});}) as any;
 try {const ctx:any={fns:{llm:{resolveEndpoint:async()=>({api,provider:api==='anthropic'?'kimi-coding':api==='responses'?'codex':'openai',modelId:'k3',url:'https://example.test',apiKey:'fake'}),refreshKimiCode:async()=> 'fake',refreshCodex:async()=> 'fake'}}};
 await expect(call(ctx,null,{user:'x',model:'kimi-coding:k3',noFallback:true,timeoutMs:30})).rejects.toThrow();expect(calls).toBe(1);expect(aborted).toBe(true);
 } finally {globalThis.fetch=previous;}
});
