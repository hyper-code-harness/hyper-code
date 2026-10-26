/**
 * Returns the run of consecutive tool_call events that ends right before a transcript index, oldest first.
 *
 * Use to keep a run of tool calls in one w.toolGroup row across renders: the live tail continues the row
 * already on screen. Events that draw nothing (job) do not break a run. Empty when the event before the index
 * is not a tool call.
 * @param opts.agentId Agent whose transcript is read.
 * @param opts.beforeIdx Transcript index the run must end before.
 * @param opts.limit How many earlier events to look through. @default 300
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose transcript is read. */
    agentId: string;
    /** Transcript index the run must end before. @minimum 0 */
    beforeIdx: number;
    /** How many earlier events to look through. @default 300 @minimum 1 @maximum 2000 */
    limit?: number;
}): Promise<any[]> {
    if (!(opts.beforeIdx > 0)) return [];
    const events = await ctx.fns.session.getEvents({ id: opts.agentId, beforeIdx: opts.beforeIdx, limit: opts.limit ?? 300 });
    const run: any[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
        const type = events[i]?.type;
        if (type === "job") continue;
        if (type !== "tool_call") break;
        run.unshift(events[i]);
    }
    return run;
}
