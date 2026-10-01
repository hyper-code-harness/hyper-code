// Remove a finished tool call from the live registry.
//
// Deliberately total: it never throws on an unknown id, so a `finally` block
// can call it without guarding, and a double call is harmless.
/**
 * Removes a tool call from the live running registry once it has finished.
 *
 * Use in a finally block paired with tools.beginRun so an indicator never outlives the work it describes; unknown ids are ignored.
 * @param opts.id Execution id returned by tools.beginRun.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Execution id returned by tools.beginRun. */
        id: string;
    },
): { ended: boolean } {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const run = registry.get(opts.id);
    if (!run) return { ended: false };
    registry.delete(opts.id);
    if (run.agentId) ctx.fns.procs.events.refresh({ topic: `agent:${run.agentId}`, reason: "tool-run-end" });
    return { ended: true };
}
