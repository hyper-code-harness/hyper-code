// Cursor subscription streamer, through the official @cursor/sdk local runtime.
//
// Cursor has no messages endpoint: its SDK owns the conversation behind an
// agentId and `send()` takes one string. So this provider is deliberately
// stateless — a fresh SDK agent per turn, with OUR whole transcript rendered
// into that string and OUR tools passed as `customTools`. Cursor's own tools
// are switched off (`tools: ["mcp"]`), so the only things the model can call
// are Hyper's; compact/fork/truncate keep working because history stays ours.
//
// Two server-side limits shape the code: `systemPrompt` is gated (the backend
// answers "unknown option '--system-prompt'"), hence the system prompt travels
// inside the rendered text; and `customTools` only reach the model through the
// Agent facade, which starts their in-process MCP server itself — the raw
// RunExecutor drops them.
//
// Same return shape as streamAnthropic / streamCodex so stream.ts can swap it in.
import { Agent, JsonlLocalAgentStore, configureCursorSdk } from "@cursor/sdk";

/**
 * Stream one turn from a Cursor subscription model via the @cursor/sdk local runtime.
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
    usage: { prompt_tokens: number; completion_tokens: number };
    toolCalls: { id: string; name: string; args: any }[];
}> {
    const { agent } = opts;
    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });
    if (!ep.apiKey) throw new Error("cursor: no API key — set llm.cursorApiKey (Cursor Dashboard → API & SSH Keys) or CURSOR_API_KEY");

    const { system, messages } = await ctx.fns.agent.buildLlmRequest({ agent });
    const prompt = ctx.fns.llm.toCursorPrompt({ system, messages });

    const storeDir = `${ctx.env.HOME}/.hyper/state/cursor-agents`;
    await ctx.fns.files.mkdir({ path: storeDir }).catch(() => null);
    configureCursorSdk({ local: { store: new JsonlLocalAgentStore(storeDir) } });

    // Cursor's local runtime walks `cwd` on every agent for rules, skills,
    // AGENTS.md and ignore files. Hyper's workspace can be a home directory,
    // where that walk costs minutes — and it buys nothing here, because the
    // model gets no Cursor tools: every file it touches goes through OUR tools,
    // which resolve against the real workspace themselves. So the SDK is given
    // an empty scratch directory to scan instead.
    const sdkCwd = `${ctx.env.HOME}/.hyper/state/cursor-workspace`;
    await ctx.fns.files.mkdir({ path: sdkCwd }).catch(() => null);

    // Hyper's own tools, in the shape Cursor's custom-tool MCP server wants.
    // `execute` does NOT run them: agent.run owns execution, approval and the
    // transcript. It records the call and stops the SDK loop instead.
    //
    // The model gets a placeholder instead of a result, and a model that reads
    // a placeholder retries: left alone it called one tool thirteen times in a
    // single request, on the user's paid quota. So the window to collect a step
    // is opened ONCE by the first call and never extended — the siblings of a
    // parallel step arrive within it, a retry does not buy the loop more time —
    // and an identical call is folded into the one already recorded rather than
    // executed twice.
    const toolCalls: { id: string; name: string; args: any }[] = [];
    const seen = new Set<string>();
    const schemas = ctx.fns.agent.wireTools({ agent, api: "anthropic" });
    const customTools: Record<string, any> = {};
    let stopLoop: (() => void) | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const PLACEHOLDER = "Call accepted by the Hyper harness. Stop now and emit no further tool calls or prose; the result arrives in the next turn.";
    for (const t of schemas) {
        customTools[t.name] = {
            description: t.description,
            inputSchema: t.input_schema,
            execute: (args: Record<string, any>, context: { toolCallId?: string }) => {
                const key = `${t.name}:${JSON.stringify(args ?? {})}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    toolCalls.push({ id: context?.toolCallId ?? `cursor_${toolCalls.length}`, name: t.name, args: args ?? {} });
                }
                stopTimer ??= setTimeout(() => stopLoop?.(), 120);
                return PLACEHOLDER;
            },
        };
    }

    const sdkAgent = await Agent.create({
        apiKey: ep.apiKey,
        model: { id: ep.modelId },
        mode: "agent",
        tools: ["mcp"],
        name: `hyper-${agent.id}`,
        local: { cwd: sdkCwd, ...(Object.keys(customTools).length ? { customTools } : {}) },
    });

    let text = "", thinking = "";
    const usage = { prompt_tokens: 0, completion_tokens: 0 };
    try {
        const run = await sdkAgent.send(prompt);
        stopLoop = () => { void run.cancel().catch(() => undefined); };
        const onAbort = () => { void run.cancel().catch(() => undefined); };
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        try {
            for await (const msg of run.stream()) {
                if (msg.type === "assistant") {
                    for (const block of (msg as any).message?.content ?? []) {
                        if (block?.type === "text" && block.text) { text += block.text; opts.onEvent?.({ type: "text_delta", delta: block.text }); }
                    }
                } else if (msg.type === "thinking") {
                    const chunk = (msg as any).message?.text ?? "";
                    if (chunk) { thinking += chunk; opts.onEvent?.({ type: "thinking_delta", delta: chunk }); }
                } else if (msg.type === "usage") {
                    const u: any = (msg as any).usage ?? {};
                    usage.prompt_tokens = u.inputTokens ?? 0;
                    usage.completion_tokens = u.outputTokens ?? 0;
                    (usage as any).cache_read_tokens = u.cacheReadTokens ?? 0;
                }
            }
        } finally { opts.signal?.removeEventListener("abort", onAbort); if (stopTimer) clearTimeout(stopTimer); }

        const result = await run.wait();
        if (result.usage) {
            usage.prompt_tokens = result.usage.inputTokens ?? usage.prompt_tokens;
            usage.completion_tokens = result.usage.outputTokens ?? usage.completion_tokens;
            (usage as any).cache_read_tokens = (result.usage as any).cacheReadTokens ?? (usage as any).cache_read_tokens ?? 0;
        }
        if (result.status === "error" || result.error) throw new Error(`cursor: ${result.error?.message ?? "run failed"}`);
        if (!text.trim() && typeof result.result === "string") text = result.result;

        // A cancel we asked for after a tool call is a normal end of turn, not
        // the user's abort: the harness runs the tool and the model continues.
        const aborted = opts.signal?.aborted === true;
        const finishReason = toolCalls.length ? "tool_calls" : aborted || result.status === "cancelled" ? "cancelled" : "stop";
        return { text, thinking, finishReason, usage, toolCalls };
    } finally {
        // One SDK agent per turn: its history is Cursor's copy of a transcript
        // we already own, and leaving it open holds a workspace executor lease.
        sdkAgent.close();
        await Agent.delete(sdkAgent.agentId).catch(() => undefined);
    }
}
