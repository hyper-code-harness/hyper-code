/**
 * Executes one non-tool LLM request through any configured provider. Supports
 * Codex subscription Responses API, OpenAI-compatible APIs, Anthropic, and mock.
 * Claude subscription requests include the required Claude Code system identity
 * without enabling tools or loading an agent transcript. Caller instructions
 * remain a separate system block. Use for runtime synthesis that is not an agent turn. Transient failures are
 * retried on the selected route first; Claude subscription calls then try the
 * same model through the alternate managed OAuth route before models from the
 * `llm.fallbackModels` setting are tried in order.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User message content. */
        user: string;
        /** Optional system instruction. */
        system?: string;
        /** Provider-qualified model; defaults to the configured model. */
        model?: string;
        /** Sampling temperature where supported. */
        temperature?: number;
        /** Maximum output tokens. */
        max_tokens?: number;
        /** OpenAI-style response format, including `json_schema`. */
        response_format?: any;
        /** Disable the configured fallback model chain for this request. @default false */
        noFallback?: boolean;
        /** Stable request/session identifier for subscription providers. */
        sessionId?: string;
        /** Total request deadline across retries; aborts provider HTTP requests and response reads. Credential refresh is checked after it returns. Omit for no deadline. @minimum 1 @maximum 3600000 */
        timeoutMs?: number;
    },
): Promise<{ text: string; finishReason: string | null; usage: any; raw: any; model?: string; fallback?: { primary: string; attempted: string[]; attempts: Array<{ model: string; count: number }> } }> {
    if(opts.timeoutMs!==undefined&&(!Number.isInteger(opts.timeoutMs)||opts.timeoutMs<1||opts.timeoutMs>3600000))throw new Error('timeoutMs must be an integer in 1..3600000');
    const signal=opts.timeoutMs===undefined?undefined:AbortSignal.timeout(opts.timeoutMs);
    const user = String(opts.user ?? "").trim();
    if (!user) throw new Error("llm.call: user is required");
    const primary = String(opts.model ?? await ctx.fns.settings.modelDefault({})).trim();
    if (!primary) throw new Error("llm.call: model is required");
    const configuredFallbacks = opts.noFallback ? "" : await (ctx.fns.settings.getString?.({
        module: "llm", scopeType: "global", key: "fallbackModels",
        fallback: "codex:gpt-5.4-mini,kimi-coding:kimi-for-coding",
    }) ?? Promise.resolve(""));
    const alternate = alternateAnthropicModel(primary);
    const models = [primary, ...(alternate ? [alternate] : []), ...String(configuredFallbacks ?? "").split(",").map(x => x.trim()).filter(Boolean)]
        .filter((model, index, all) => all.indexOf(model) === index);
    const attempted: string[] = [];
    const attempts: Array<{ model: string; count: number }> = [];
    let lastError: unknown;
    for (const model of models) {
        attempted.push(model);
        let count = 0;
        try {
            while (true) {
                count++;
                try {
                    signal?.throwIfAborted();
                    const result = await callModel(ctx, { ...opts, model, user, signal });
                    attempts.push({ model, count });
                    return attempted.length === 1 && count === 1
                        ? { ...result, model }
                        : { ...result, model, fallback: { primary, attempted, attempts } };
                } catch (error) {
                    signal?.throwIfAborted();
                    lastError = error;
                    if (count >= 3 || !shouldRetrySameModel(error)) throw error;
                    await Bun.sleep(count === 1 ? 500 : 1_500);
                }
            }
        } catch (error) {
            signal?.throwIfAborted();
            lastError = error;
            attempts.push({ model, count });
            if (opts.noFallback || !shouldFallback(error) || model === models.at(-1)) throw error;
        }
    }
    throw lastError;
}

async function callModel(ctx: Context, opts: any): Promise<{ text: string; finishReason: string | null; usage: any; raw: any }> {
    const model = String(opts.model).trim();
    const user = String(opts.user).trim();
    const system = String(opts.system ?? "").trim();
    const endpoint = await ctx.fns.llm.resolveEndpoint({ model });

    if (endpoint.api === "mock") return normalizeStructured({ text: user, finishReason: "stop", usage: null, raw: { mock: true } }, opts.response_format);
    const result = endpoint.provider === "xai" ? await xaiResponses(ctx, endpoint, { ...opts, user, system })
        : endpoint.api === "responses" ? await responses(ctx, endpoint, { ...opts, user, system })
            : endpoint.api === "anthropic" ? await anthropic(ctx, endpoint, { ...opts, user, system })
                : await openAI(endpoint, { ...opts, user, system });
    return normalizeStructured(result, opts.response_format);
}

function alternateAnthropicModel(model: string): string | null {
    const match = /^(claude-code|anthropic-oauth)(?:\/([^:]+))?:(.+)$/.exec(model);
    if (!match) return null;
    const provider = match[1]!;
    const account = match[2] ?? "default";
    const modelId = match[3]!;
    if (provider === "claude-code") return `anthropic-oauth:${modelId}`;
    if (account !== "default") return `anthropic-oauth:${modelId}`;
    return `claude-code:${modelId}`;
}

function shouldRetrySameModel(error: unknown): boolean {
    const message = String((error as any)?.message ?? error);
    if (/usage_limit_reached|usage limit (?:has been )?reached|quota_exceeded|credits_depleted|out of credits/i.test(message)) return false;
    return /\b429\b|rate.?limit|\b5\d\d\b|timeout|timed out|ETIMEDOUT|ECONNRESET|network|connection (?:reset|refused|closed)|overloaded|service unavailable/i.test(message);
}

function shouldFallback(error: unknown): boolean {
    const message = String((error as any)?.message ?? error);
    if (/\b(?:400|401|403|404|409|413|422)\b/.test(message)) return false;
    if (/context_length_exceeded|request_too_large|prompt is too long|exceeds the context|invalid|unsupported|authentication|unauthorized/i.test(message)) return false;
    return /\b429\b|rate.?limit|usage_limit|quota|credits_depleted|\b5\d\d\b|timeout|timed out|ETIMEDOUT|ECONNRESET|network|connection (?:reset|refused|closed)|overloaded|service unavailable|no credentials|unknown provider/i.test(message);
}

async function xaiResponses(ctx: Context, endpoint: any, opts: any) {
    const token = await ctx.fns.llm.getXaiOAuthToken({ account: endpoint.account });
    const body: any = {
        model: endpoint.modelId,
        store: false,
        stream: true,
        instructions: opts.system || "You are a helpful assistant.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: opts.user }] }],
        include: ["reasoning.encrypted_content"],
    };
    const format = responsesFormat(opts.response_format);
    if (format) body.text = { format };
    if (opts.max_tokens != null) body.max_output_tokens = opts.max_tokens;
    if (opts.temperature != null) body.temperature = opts.temperature;
    const response = await fetch(endpoint.url, {
        signal: opts.signal,
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            accept: "text/event-stream",
            "content-type": "application/json",
            session_id: opts.sessionId || Bun.randomUUIDv7(),
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${endpoint.provider} ${response.status}: ${await response.text()}`);
    const raw: any = await readResponsesSSE(response);
    ctx.fns.llm.refreshUsage?.({ provider: endpoint.provider, account: endpoint.account, maxAgeMs: 60_000 })?.catch(() => undefined);
    return { text: responseText(raw), finishReason: raw.status === "completed" ? "stop" : raw.status ?? null, usage: raw.usage, raw };
}


async function responses(ctx: Context, endpoint: any, opts: any) {
    const token = await ctx.fns.llm.refreshCodex({ account: endpoint.account }) ?? endpoint.apiKey;
    if (!token) throw new Error("codex: no access_token");
    const body: any = {
        model: endpoint.modelId,
        store: false,
        stream: true,
        instructions: opts.system || "You are a helpful assistant.",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: opts.user }] }],
        text: { verbosity: "low" },
    };
    const format = responsesFormat(opts.response_format);
    if (format) body.text.format = format;
    // ChatGPT Codex backend controls output limits and sampling; neither
    // max_output_tokens nor temperature is accepted by the subscription API.
    const response = await fetch(endpoint.url, {
        signal: opts.signal,
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "chatgpt-account-id": accountId(token),
            originator: "codex_cli_rs",
            "OpenAI-Beta": "responses=experimental",
            "content-type": "application/json",
            session_id: opts.sessionId || Bun.randomUUIDv7(),
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${endpoint.provider} ${response.status}: ${await response.text()}`);
    const raw: any = await readResponsesSSE(response);
    return { text: responseText(raw), finishReason: raw.status === "completed" ? "stop" : raw.status ?? null, usage: raw.usage, raw };
}

async function openAI(endpoint: any, opts: any) {
    const messages = [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content: opts.user }];
    const body: any = { model: endpoint.modelId, messages, stream: false };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.max_tokens != null) body.max_tokens = opts.max_tokens;
    if (opts.response_format != null) body.response_format = opts.response_format;
    let response = await fetch(endpoint.url, { signal: opts.signal, method: "POST", headers: { "content-type": "application/json", ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}) }, body: JSON.stringify(body) });
    response = await retryWithoutUnsupportedTemperature(response, body, () => fetch(endpoint.url, { signal: opts.signal, method: "POST", headers: { "content-type": "application/json", ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}) }, body: JSON.stringify(body) }));
    if (!response.ok) throw new Error(`${endpoint.provider} ${response.status}: ${await response.text()}`);
    const raw: any = await response.json();
    const choice = raw?.choices?.[0] ?? {};
    return { text: String(choice?.message?.content ?? ""), finishReason: choice?.finish_reason ?? null, usage: raw?.usage, raw };
}

async function anthropic(ctx: Context, endpoint: any, opts: any) {
    let apiKey = endpoint.apiKey;
    const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
    if (endpoint.provider === "kimi-coding") {
        apiKey = await ctx.fns.llm.refreshKimiCode({ account: endpoint.account }) ?? apiKey;
    } else if (endpoint.provider === "claude-code") {
        apiKey = await ctx.fns.llm.refreshClaudeCode({ account: endpoint.account }) ?? apiKey;
    } else if (endpoint.provider === "anthropic-oauth") {
        apiKey = await ctx.fns.llm.getAnthropicOAuthToken({ account: endpoint.account });
    }
    const subscription = endpoint.provider === "claude-code" || endpoint.provider === "anthropic-oauth" || endpoint.provider === "claude-proxy";
    if (apiKey) {
        if (subscription || endpoint.provider === "kimi-coding") headers.authorization = `Bearer ${apiKey}`;
        else headers["x-api-key"] = apiKey;
    }
    if (subscription) {
        const version = await ctx.fns.llm.claudeCodeCliVersion({});
        headers["anthropic-beta"] = ctx.env.CLAUDE_CODE_ANTHROPIC_BETA ?? ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"].join(",");
        headers["user-agent"] = ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${version} (external, sdk-cli)`;
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    if (!apiKey) throw new Error(`${endpoint.provider}: no credentials`);
    const body: any = { model: endpoint.modelId, max_tokens: opts.max_tokens ?? 2048, messages: [{ role: "user", content: opts.user }] };
    if (subscription) {
        // Match the identity required by the working agent transport. Omitting
        // it can produce a misleading 429 even when the subscription has quota.
        body.system = [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }];
        if (opts.system) body.system.push({ type: "text", text: opts.system });
    } else if (opts.system) body.system = opts.system;
    if (opts.temperature != null) body.temperature = opts.temperature;
    let response = await fetch(endpoint.url, { signal: opts.signal, method: "POST", headers, body: JSON.stringify(body) });
    response = await retryWithoutUnsupportedTemperature(response, body, () => fetch(endpoint.url, { signal: opts.signal, method: "POST", headers, body: JSON.stringify(body) }));
    if (!response.ok) throw new Error(`${endpoint.provider} ${response.status}: ${await response.text()}`);
    const raw: any = await response.json();
    return { text: (raw.content ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join(""), finishReason: raw.stop_reason ?? null, usage: raw.usage, raw };
}

async function retryWithoutUnsupportedTemperature(response: Response, body: any, retry: () => Promise<Response>): Promise<Response> {
    if (response.ok || response.status !== 400 || body.temperature == null) return response;
    const detail = await response.text();
    if (!/temperature/i.test(detail) || !/deprecat|not support|unsupported/i.test(detail)) {
        throw new Error(`400: ${detail}`);
    }
    delete body.temperature;
    return retry();
}


async function readResponsesSSE(response: Response): Promise<any> {
    if (!response.body) throw new Error("codex: empty response body");
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated: any = null;
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n").trim();
            if (!data || data === "[DONE]") continue;
            let event: any; try { event = JSON.parse(data); } catch { continue; }
            if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
                accumulated ??= { output: [{ type: "message", content: [{ type: "output_text", text: "" }] }] };
                accumulated.output[0].content[0].text += event.delta;
            }
            if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) {
                const final = event.response ?? {};
                if (accumulated?.output?.[0]?.content?.[0]?.text && !final.output?.length) final.output = accumulated.output;
                return final;
            }
        }
    }
    return accumulated ?? {};
}


function normalizeStructured(result: { text: string; finishReason: string | null; usage: any; raw: any }, format: any) {
    if (!format) return result;
    const cleaned = String(result.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let value: any;
    try { value = JSON.parse(cleaned); } catch { throw new Error("llm.call: provider returned invalid structured JSON"); }
    const schema = format?.type === "json_schema" ? (format.json_schema?.schema ?? format.schema) : null;
    if (schema) {
        if (schema.type === "object" && (!value || Array.isArray(value) || typeof value !== "object")) throw new Error("llm.call: structured response is not an object");
        for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`llm.call: structured response missing ${key}`);
        if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) throw new Error(`llm.call: structured response has unknown property ${key}`);
    }
    return { ...result, text: JSON.stringify(value) };
}


function responsesFormat(format: any): any {
    if (!format) return null;
    if (format.type === "json_schema") {
        const value = format.json_schema ?? format;
        return { type: "json_schema", name: value.name ?? "response", strict: value.strict ?? true, schema: value.schema };
    }
    return format.type === "json_object" ? { type: "json_object" } : null;
}
function responseText(raw: any): string {
    if (typeof raw?.output_text === "string") return raw.output_text;
    return (raw?.output ?? []).flatMap((item: any) => item?.content ?? []).map((block: any) => block?.text ?? block?.output_text ?? "").join("");
}
function accountId(token: string): string {
    try { const payload = JSON.parse(Buffer.from(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id ?? ""; } catch { return ""; }
}
