// Dispatcher — picks the wire-protocol implementation based on endpoint.api.
// Same return shape regardless of provider — callers don't care.
/** Performs the llm.stream runtime operation. */
/**
 * Dispatcher — picks the wire-protocol implementation based on endpoint.api.
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
) {
    const { agent } = opts;
    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });
    const started = performance.now();
    const reasoning = await ctx.fns.llm.resolveReasoningEffort({ model: agent.model, effort: agent.reasoningEffort ?? "auto" });
    let firstEventMs: number | undefined;
    const onEvent = (ev: any) => {
        firstEventMs ??= Math.round((performance.now() - started) * 100) / 100;
        opts.onEvent?.(ev);
    };
    const attrs: Record<string, any> = {
        "llm.provider": ep.provider,
        "llm.model": ep.modelId,
        "agent.id": agent.id,
        "llm.reasoning_effort.requested": reasoning.requested,
        "llm.reasoning_effort.applied": reasoning.applied,
        "llm.reasoning_mode": reasoning.mode,
    };
    const request = async () => {
        const wireOpts = { ...opts, onEvent };
        let result: any;
        if (ep.api === "mock") result = await ctx.fns.llm.streamMock(wireOpts);
        else if (ep.api === "anthropic") result = await ctx.fns.llm.streamAnthropic(wireOpts);
        else if (ep.api === "cursor") result = await ctx.fns.llm.streamCursor(wireOpts);
        else if (ep.provider === "xai") result = await ctx.fns.llm.streamXai(wireOpts);
        else if (ep.api === "responses") result = await ctx.fns.llm.streamCodex(wireOpts);
        else result = await ctx.fns.llm.streamOpenAI(wireOpts);
        attrs["llm.ttft_ms"] = firstEventMs ?? null;
        attrs["llm.finish_reason"] = result?.finishReason ?? null;
        attrs["llm.prompt_tokens"] = result?.usage?.prompt_tokens ?? result?.usage?.input_tokens ?? null;
        attrs["llm.completion_tokens"] = result?.usage?.completion_tokens ?? result?.usage?.output_tokens ?? null;
        return result;
    };
    const telemetry: any = (ctx.fns.procs as any).telemetry;
    return await (typeof telemetry?.safeSpan === "function"
        ? telemetry.safeSpan({ name: "llm.request", attrs, fn: request })
        : request());
}
