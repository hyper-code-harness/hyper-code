// Stop ONE running tool call without stopping the agent.
//
// This is the distinction the stop button cannot make: agent.stop kills the
// whole run and resets the row, which is far too much when all the user wants
// is to get out of a shell command that will clearly never return. Here the
// call is cancelled, the tool reports an honest "aborted by user" result, and
// the agent carries on with that as its tool output.
/**
 * Cancels a single executing tool call while leaving the agent run alive.
 *
 * Use when a user asks to abandon one long tool call; the tool returns an aborted result and the agent continues its turn with that output.
 * @param opts.id Execution id of the running call, from tools.runs.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Execution id of the running call, from tools.runs. */
        id: string;
    },
): { aborted: boolean; name?: string } {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const run = registry.get(opts.id);
    if (!run) return { aborted: false };
    run.aborted = true;
    try { run.controller.abort("aborted_by_user"); } catch { /* an already-aborted controller is the state we wanted */ }
    if (run.agentId) ctx.fns.procs.events.refresh({ topic: `agent:${run.agentId}`, reason: "tool-run-abort" });
    return { aborted: true, name: run.name };
}
