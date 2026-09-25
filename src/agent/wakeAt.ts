/**
 * Schedules a legacy one-shot wake through the unified trigger engine
 *
 * Compatibility wrapper for callers using the old wakeAt API. Creates an agent.wake trigger and returns the legacy result shape. Prefer agent.wake for new code.
 * @param opts.id Target agent identifier.
 * @param opts.at Absolute future Unix timestamp in milliseconds.
 * @param opts.reason Prompt inserted when the trigger fires.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Absolute future Unix timestamp in milliseconds. */
        at: number;
        /** Prompt inserted when the trigger fires. */
        reason: string;
    },
): Promise<{ wakeAt: number; reason: string }> {
    const reason=String(opts.reason??"").trim();await ctx.fns.agent.wake({id:opts.id,at:opts.at,prompt:reason});return{wakeAt:Math.floor(opts.at),reason};
}
