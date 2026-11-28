/**
 * Streams Grok subscription requests through the xAI Responses API
 *
 * Send an agent turn through the xAI Responses API using a managed SuperGrok or X Premium OAuth token. Use for xai model routes that need normalized text, reasoning summaries, native tool calls, usage and subscription error classification.
 * @param opts.agent Agent whose model, transcript, tools and session identity are sent.
 * @param opts.signal Abort signal for cancelling the request.
 * @param opts.onEvent Callback receiving normalized stream deltas.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose model, transcript, tools and session identity are sent. */
        agent: types.agent.Agent;
        /** Abort signal for cancelling the request. */
        signal?: AbortSignal;
        /** Callback receiving normalized stream deltas. */
        onEvent?: (ev: any) => void;
    },
): Promise<{ text: string; thinking: string; finishReason: string | null; usage: { prompt_tokens: number; completion_tokens: number }; toolCalls: { id: string; name: string; args: any }[] }> {
    const { agent } = opts;
    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });
    if (ep.provider !== "xai") throw new Error("streamXai requires an xai model route");
    const apiKey = await ctx.fns.llm.getXaiOAuthToken({ account: ep.account });
    const reasoning = await ctx.fns.llm.resolveReasoningEffort({ model: agent.model, effort: agent.reasoningEffort ?? "auto" });
    const { system: instructions, messages: convo } = await ctx.fns.agent.buildLlmRequest({ agent });
    const { input } = ctx.fns.llm.toCodexInput({ messages: convo as any });
    const body: any = { model: ep.modelId, store: false, stream: true, instructions, input, prompt_cache_key: await ctx.fns.agent.cacheRoot({ agent }), include: ["reasoning.encrypted_content"] };
    if (reasoning.applied !== "off") body.reasoning = { effort: reasoning.applied };
    const tools = ctx.fns.agent.wireTools({ agent, api: "responses" });
    if (tools.length) { body.tools = tools; body.parallel_tool_calls = true; }
    const send = () => ctx.fns.llm.connectFetch({ url: ep.url, init: { method: "POST", headers: { authorization: `Bearer ${apiKey}`, accept: "text/event-stream", "content-type": "application/json", session_id: agent.id }, body: JSON.stringify(body), signal: opts.signal } });
    const accounting = (ctx.fns as any).llmUsage;
    const res: Response = await (typeof accounting?.fetch === "function"
        ? ctx.fns.llmUsage.fetch({ provider: ep.provider, account: ep.account, model: ep.modelId, api: "responses", send })
        : send());
    if (!res.ok) {
      if (res.status === 401) await ctx.fns.llm.accountAuthHealth({ action: "mark", provider: ep.provider, account: ep.account });
      const raw = await res.text();
      const info = ctx.fns.llm.classifyError({ provider: ep.provider, account: ep.account, kind: ep.kind, status: res.status, body: raw, headers: res.headers });
      const err: any = new Error(info.message); Object.assign(err, info); throw err;
    }
    await ctx.fns.llm.accountAuthHealth({ action: "clear", provider: ep.provider, account: ep.account });
    if (!res.body) throw new Error("xai: empty response body");
    let text = "", thinking = "", finishReason: string | null = null;
    const usage = { prompt_tokens: 0, completion_tokens: 0 };
    const toolCalls: { id: string; name: string; args: any }[] = [];
    for await (const { data } of ctx.fns.llm.parseSSE({ body: res.body })) {
      if (!data || data === "[DONE]") continue;
      let ev: any; try { ev = JSON.parse(data); } catch { continue; }
      const t = ev.type;
      if (t === "response.output_text.delta" && typeof ev.delta === "string") { text += ev.delta; opts.onEvent?.({ type: "text_delta", delta: ev.delta }); }
      else if ((t === "response.reasoning_summary_text.delta" || t === "response.reasoning_text.delta") && typeof ev.delta === "string") { thinking += ev.delta; opts.onEvent?.({ type: "thinking_delta", delta: ev.delta }); }
      else if (t === "response.function_call_arguments.delta" && typeof ev.delta === "string") opts.onEvent?.({ type: "tool_args_delta", delta: ev.delta, id: ev.item_id });
      else if (t === "response.output_item.done" && ev.item?.type === "function_call") toolCalls.push({ id: ev.item.call_id ?? ev.item.id, name: ev.item.name, args: parseArgs(ev.item.arguments) });
      else if (t === "response.completed" || t === "response.incomplete") { const u = ev.response?.usage; if (u) { usage.prompt_tokens = u.input_tokens ?? 0; usage.completion_tokens = u.output_tokens ?? 0; (usage as any).cache_read_tokens = u.input_tokens_details?.cached_tokens ?? 0; } finishReason = t === "response.incomplete" ? (ev.response?.incomplete_details?.reason === "max_output_tokens" ? "length" : "incomplete") : "stop"; }
      else if (t === "response.failed" || t === "error") throw new Error(`xai ${t}: ${ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? ev.code ?? "unknown error"}`);
    }
    ctx.fns.llm.refreshUsage?.({ provider: ep.provider, account: ep.account, maxAgeMs: 60_000 })?.catch(() => undefined);

    return { text, thinking, finishReason, usage, toolCalls };
    function parseArgs(raw: unknown): any { const value = typeof raw === "string" ? raw : ""; if (!value.trim()) return {}; try { return JSON.parse(value); } catch { return { __unparsed: value }; } }
}
