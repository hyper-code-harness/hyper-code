// The live registry of running tool calls, keyed by execution id.
//
// Memory is the right home for it: ctx.state is the same place agent.isStreaming
// lives, it dies with the process (as a running call does), and reading it costs
// no query on a path the chat polls every few seconds.
/**
 * Lists tool calls executing at this instant, longest-running first.
 *
 * Use to render a live "still working" indicator or to find the id an abort should target; the first entry is the call a waiting user is blocked on. Returns an empty array when nothing is running.
 * @param opts.agentId Restrict to one agent's calls; omitted returns every live call on this server.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Restrict to one agent's calls; omitted returns every live call on this server. */
        agentId?: string;
    } = {},
): types.tools.ToolRun[] {
    const registry: Map<string, types.tools.ToolRun> = ((ctx.state as any).toolRuns ??= new Map());
    const all = [...registry.values()];
    const mine = opts.agentId ? all.filter(run => run.agentId === opts.agentId) : all;
    // OLDEST first — the long call is the one the user is waiting on and the one
    // worth explaining. Sorting by "newest" put a 1-second bookkeeping call at
    // the head and hid the 30-minute build behind it, which is precisely the
    // question this feature exists to answer.
    return mine.sort((a, b) => a.startedAt - b.startedAt);
}
