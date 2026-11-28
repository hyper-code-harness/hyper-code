/**
 * Stream an agent request through an OpenAI-compatible endpoint.
 *
 * Supports API and local LM Studio routes, native tool calls and provider usage
 * frames. Physical sends join the calling stream's accounting scope without
 * storing request or response text.
 * @param opts.agent Agent associated with the operation.
 * @param opts.signal Abort signal for cancelling the request.
 * @param opts.onEvent Callback invoked for each normalized stream event.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent associated with the operation. */ agent: types.agent.Agent;
        /** Abort signal for cancelling the operation. */ signal?: AbortSignal;
        /** Callback invoked for each streamed model event. */ onEvent?: (ev: any) => void },
): Promise<{
    text: string;
    thinking: string;
    finishReason: string | null;
    usage: any;
    toolCalls: { id: string; name: string; args: any }[];
}> {
    const { agent } = opts;
    const { system: sys, messages: convo } = await ctx.fns.agent.buildLlmRequest({ agent });
    const messages: any[] = [];
    if (sys) messages.push({ role: "system", content: sys });
    messages.push(...ctx.fns.llm.toOpenAIMessages({ messages: convo }));

    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });

    const body: any = {
        model: ep.modelId,
        messages,
        stream: true,
        stream_options: { include_usage: true },
    };
    // OpenAI-compatible providers do not consistently accept OpenAI's cache
    // extension. Groq currently rejects prompt_cache_key with HTTP 400.
    if (ep.provider === "openai") body.prompt_cache_key = await ctx.fns.agent.cacheRoot({ agent });

    // Native function calls, in JSON protocol mode only (see agent.wireTools).
    const tools = ctx.fns.agent.wireTools({ agent, api: "openai" });
    if (tools.length) {
        body.tools = tools;
        body.parallel_tool_calls = true;
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ep.apiKey) headers["authorization"] = `Bearer ${ep.apiKey}`;

    const send = () => ctx.fns.llm.connectFetch({ url: ep.url, init: {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
    } });
    const accounting = (ctx.fns as any).llmUsage;
    const res: Response = await (typeof accounting?.fetch === "function"
        ? ctx.fns.llmUsage.fetch({ provider: ep.provider, account: ep.account, model: ep.modelId, api: "openai", send })
        : send());
    if (!res.ok) throw new Error(`${ep.provider} ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error("empty response body");

    let text = "";
    let thinking = "";
    let finishReason: string | null = null;
    let usage: any = undefined;
    // Arguments arrive as a JSON string split across deltas, keyed by index —
    // the pieces are concatenated per slot and parsed once at the end.
    const slots: { id: string; name: string; buf: string }[] = [];

    for await (const { data } of ctx.fns.llm.parseSSE({ body: res.body })) {
        if (data === "[DONE]") break;
        let parsed: any;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.usage) usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content.length > 0) {
            text += delta.content;
            opts.onEvent?.({ type: "text_delta", delta: delta.content });
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
            thinking += delta.reasoning_content;
            opts.onEvent?.({ type: "thinking_delta", delta: delta.reasoning_content });
        }
        for (const tc of delta.tool_calls ?? []) {
            const i = Number(tc.index ?? 0);
            const slot = (slots[i] ??= { id: "", name: "", buf: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (typeof tc.function?.arguments === "string") slot.buf += tc.function.arguments;
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    const toolCalls = slots.filter(Boolean).map(s => ({ id: s.id, name: s.name, args: parseArgs(s.buf) }));
    return { text, thinking, finishReason, usage, toolCalls };
}

// Without strict decoding the arguments are best-effort JSON, and a truncated
// reply can end mid-object. A parse failure travels as an argument the schema
// will reject by name, rather than as an exception that kills the run.
function parseArgs(buf: string): any {
    if (!buf.trim()) return {};
    try { return JSON.parse(buf); } catch { return { __unparsed: buf }; }
}
