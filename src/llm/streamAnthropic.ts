// Stream from an Anthropic Messages API endpoint (anthropic.com, kimi.com/coding, etc).
/** Performs the llm.streamAnthropic runtime operation. */
/**
 * Stream from an Anthropic Messages API endpoint (anthropic.com, kimi.com/coding, etc).
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
    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });

    const reasoning = await ctx.fns.llm.resolveReasoningEffort({ model: agent.model, effort: agent.reasoningEffort ?? "auto" });
    // buildLlmRequest keeps the required Claude Code identity in the top-level
    // system field for both externally managed and hyper-code2-managed OAuth.
    const { system, messages: convo } = await ctx.fns.agent.buildLlmRequest({ agent });
    // Prompt caching. Two breakpoints: the bootstrap turn (tools + system +
    // core prompt — identical for every turn and for every transcript-sharing
    // fork) and the tail of the conversation, so each request re-reads the
    // previous one's prefix instead of paying for the whole transcript.
    const messages = ctx.fns.llm.toAnthropicMessages({ messages: convo });
    const mark = (message: any) => {
        const block = message?.content?.[message.content.length - 1];
        if (block && typeof block === "object") block.cache_control = { type: "ephemeral" };
    };
    if (messages.length > 2 && messages[1]?.role === "assistant") mark(messages[1]);
    mark(messages[messages.length - 1]);

    const body: any = {
        model: ep.modelId,
        system,
        messages,
        stream: true,
        max_tokens: 16384,
    };

    if (reasoning.mode === "anthropic-adaptive" && reasoning.applied !== "off") {
        body.thinking = { type: "adaptive" };
        body.output_config = { effort: reasoning.applied === "xhigh" ? "max" : reasoning.applied };
    } else if (reasoning.mode === "anthropic-adaptive") {
        body.thinking = { type: "disabled" };
    }
    // Native tool_use blocks, in JSON protocol mode only (see agent.wireTools).
    const tools = ctx.fns.agent.wireTools({ agent, api: "anthropic" });
    if (tools.length) body.tools = tools;

    const headers: Record<string, string> = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
    };
    // Subscription tokens are refreshed lazily immediately before sending:
    //   kimi-coding      → ~/.kimi/credentials/kimi-code.json
    //   claude-code      → macOS keychain "Claude Code-credentials"
    //   anthropic-oauth  → encrypted Postgres credential
    let apiKey = ep.apiKey;
    if (ep.provider === "kimi-coding") {
        const fresh = await ctx.fns.llm.refreshKimiCode({ account: ep.account });
        if (fresh) apiKey = fresh;
    } else if (ep.provider === "claude-code") {
        const fresh = await ctx.fns.llm.refreshClaudeCode({ account: ep.account });
        if (fresh) apiKey = fresh;
    } else if (ep.provider === "anthropic-oauth") {
        apiKey = await ctx.fns.llm.getAnthropicOAuthToken({ account: ep.account });
    }

    const claudeSubscription = ep.provider === "claude-code" || ep.provider === "anthropic-oauth" || ep.provider === "claude-proxy";
    if (apiKey) {
        // Authentication semantics come from the selected provider, not from a
        // token-prefix heuristic. This prevents accidental billing/auth changes.
        if (claudeSubscription || ep.provider === "kimi-coding") {
            headers["authorization"] = `Bearer ${apiKey}`;
        } else {
            headers["x-api-key"] = apiKey;
        }
    }
    // Both subscription sources must identify as Claude Code. Keep this one
    // shared block so managed OAuth and official-CLI credential reuse cannot
    // drift. Environment names remain backwards-compatible.
    if (claudeSubscription) {
        const cliVersion = await ctx.fns.llm.claudeCodeCliVersion({});
        const baseBeta = ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"];
        headers["anthropic-beta"] = ctx.env.CLAUDE_CODE_ANTHROPIC_BETA ?? baseBeta.join(",");
        headers["user-agent"] = ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${cliVersion} (external, sdk-cli)`;
        headers["x-app"] = "cli";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
        headers["x-client-request-id"] = (globalThis as any).crypto?.randomUUID?.() ?? Bun.randomUUIDv7();
    }

    const res = await ctx.fns.llm.connectFetch({ url: ep.url, init: {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
    } });
    if (!res.ok) {
        // Same classification path as streamCodex: a spent Claude subscription
        // window must arrive at the worker as a parkable failure carrying its
        // reset moment, not as an opaque "provider 429: {…}" string.
        const info = ctx.fns.llm.classifyError({
            provider: ep.provider, account: ep.account, kind: ep.kind,
            status: res.status, body: await res.text(), headers: res.headers,
        });
        const error = new Error(info.message);
        (error as any).failure = info;
        throw error;
    }
    if (!res.body) throw new Error("empty response body");

    let text = "";
    let thinking = "";
    let finishReason: string | null = null;
    let usage: any = { prompt_tokens: 0, completion_tokens: 0 };
    // A tool_use block opens with its id and name, then its input arrives as a
    // JSON string across input_json_delta events, keyed by content-block index.
    const slots = new Map<number, { id: string; name: string; buf: string }>();

    for await (const { event, data } of ctx.fns.llm.parseSSE({ body: res.body })) {
        let msg: any;
        try { msg = JSON.parse(data); } catch { continue; }
        const type = event ?? "message";
        if (type === "message_start") {
            const u = msg.message?.usage;
            if (u) {
                usage.prompt_tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
                usage.cache_read_tokens = u.cache_read_input_tokens ?? 0;
                usage.cache_write_tokens = u.cache_creation_input_tokens ?? 0;
            }
        } else if (type === "content_block_start") {
            const block = msg.content_block ?? {};
            if (block.type === "tool_use") {
                slots.set(Number(msg.index ?? 0), { id: block.id, name: block.name, buf: "" });
            }
        } else if (type === "content_block_delta") {
            const d = msg.delta ?? {};
            if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
                const slot = slots.get(Number(msg.index ?? 0));
                if (slot) slot.buf += d.partial_json;
            }
            if (d.type === "text_delta" && typeof d.text === "string") {
                text += d.text;
                opts.onEvent?.({ type: "text_delta", delta: d.text });
            } else if (d.type === "thinking_delta" && typeof d.thinking === "string") {
                thinking += d.thinking;
                opts.onEvent?.({ type: "thinking_delta", delta: d.thinking });
            }
        } else if (type === "message_delta") {
            if (msg.delta?.stop_reason) finishReason = msg.delta.stop_reason;
            if (msg.usage?.output_tokens != null) usage.completion_tokens = msg.usage.output_tokens;
        }
    }

    const toolCalls = [...slots.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, s]) => ({ id: s.id, name: s.name, args: parseArgs(s.buf) }));
    // Subscription quota travels in the unified rate-limit headers of every OK
    // response; recording it here is what makes the left panel honest without
    // a single extra request.
    if (ep.kind === "subscription") {
        ctx.fns.llm.recordUsage?.({ provider: ep.provider, account: ep.account, headers: res.headers })?.catch(() => undefined);
    }
    return { text, thinking, finishReason: mapStop(finishReason), usage, toolCalls };
}

// Anthropic buffers tool input into valid JSON unless fine-grained streaming is
// on, but a truncated reply can still end mid-object. A parse failure travels
// as an argument the schema will reject by name, not as a thrown run.
function parseArgs(buf: string): any {
    if (!buf.trim()) return {};
    try { return JSON.parse(buf); } catch { return { __unparsed: buf }; }
}

function mapStop(r: string | null): string | null {
    if (!r) return null;
    if (r === "end_turn" || r === "stop_sequence") return "stop";
    if (r === "max_tokens") return "length";
    return r;
}
