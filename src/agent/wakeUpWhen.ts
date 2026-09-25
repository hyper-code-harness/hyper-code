/**
 * Creates a legacy conditional wake through the unified trigger engine
 *
 * Compatibility wrapper for callers using the old wakeUpWhen API. Creates a one-shot agent.watch and returns the legacy result shape. Prefer agent.watch for new code.
 * @param opts.id Target agent identifier.
 * @param opts.predicate Condition implementation.
 * @param opts.opts Predicate-specific options.
 * @param opts.reason Prompt inserted when ready.
 * @param opts.everyMs Polling interval.
 * @param opts.timeoutMs Watch timeout.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Condition implementation. */
        predicate: "file.exists" | "db.rows" | "http.ok" | "runtime.fn";
        /** Predicate-specific options. */
        opts: Record<string, any>;
        /** Prompt inserted when ready. */
        reason: string;
        /** Polling interval. */
        everyMs?: number;
        /** Watch timeout. */
        timeoutMs?: number;
    },
): Promise<{ watchId: string; nextCheckAt: number; timeoutAt: number }> {
    const made=await ctx.fns.agent.watch({id:opts.id,predicate:opts.predicate,opts:opts.opts,prompt:opts.reason,everyMs:opts.everyMs,timeoutMs:opts.timeoutMs,mode:"once"});return{watchId:made.id,nextCheckAt:made.nextAt,timeoutAt:made.timeoutAt??0};
}
