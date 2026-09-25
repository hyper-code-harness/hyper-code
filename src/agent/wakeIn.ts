/**
 * Schedules a legacy delayed wake through the unified trigger engine
 *
 * Compatibility wrapper for callers using the old wakeIn API. Creates an agent.wake trigger after a delay. Prefer agent.wake for new code.
 * @param opts.id Target agent identifier.
 * @param opts.delayMs Delay in milliseconds.
 * @param opts.reason Prompt inserted when the trigger fires.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
        /** Delay in milliseconds. */
        delayMs: number;
        /** Prompt inserted when the trigger fires. */
        reason: string;
    },
): Promise<{ wakeAt: number; reason: string }> {
    const delayMs=Math.max(1000,Math.floor(Number(opts.delayMs)));const reason=String(opts.reason??"").trim();const made=await ctx.fns.agent.wake({id:opts.id,inMs:delayMs,prompt:reason});return{wakeAt:made.nextAt,reason};
}
