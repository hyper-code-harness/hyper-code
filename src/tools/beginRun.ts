// Register a tool call as running and hand back the handle that ends it.
//
// Called by ctx.fns.tools.call for EVERY tool, not by individual tools: one
// registration point means a new tool cannot forget to announce itself, and
// the chat indicator never has a blind spot.
/**
 * Registers a tool call as currently executing and returns its live entry.
 *
 * Use from the single tool dispatch path so the chat can show a running indicator and offer an abort; always pair with tools.endRun in a finally block.
 * @param opts.agentId Agent the call belongs to; empty for calls made outside an agent run.
 * @param opts.name Wire name of the tool being executed.
 * @param opts.args Arguments of the call, used to derive the displayed subject.
 * @param opts.timeoutMs Declared deadline in milliseconds; omitted means open-ended.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent the call belongs to; empty for calls made outside an agent run. */
        agentId?: string;
        /** Wire name of the tool being executed. */
        name: string;
        /** Arguments of the call, used to derive the displayed subject. */
        args?: any;
        /** Declared deadline in milliseconds; omitted means open-ended. */
        timeoutMs?: number;
    },
): types.tools.ToolRun {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const meta = ctx.fns.agent.toolMeta({ name: opts.name, args: opts.args });
    const run: types.tools.ToolRun = {
        id: Bun.randomUUIDv7(),
        agentId: String(opts.agentId ?? ""),
        name: String(opts.name),
        subject: String(meta.subject ?? "").slice(0, 300),
        icon: String(meta.icon ?? "ph-wrench").replace(/^ph-/, ""),
        startedAt: Date.now(),
        timeoutMs: Number.isFinite(opts.timeoutMs) && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : null,
        tail: "",
        aborted: false,
        controller: new AbortController(),
    };
    registry.set(run.id, run);

    // Tell the open chats immediately. Without this the indicator would only
    // appear on the next watchdog tick — up to 30 seconds of the exact silence
    // this whole feature exists to remove.
    if (run.agentId) ctx.fns.procs.events.refresh({ topic: `agent:${run.agentId}`, reason: "tool-run-start" });
    return run;
}
