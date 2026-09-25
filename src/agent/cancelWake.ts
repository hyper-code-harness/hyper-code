/**
 * Cancels legacy one-shot wakes in the unified trigger engine
 *
 * Compatibility wrapper that cancels every active one-shot time trigger for an agent. Prefer cancelTrigger when a specific trigger id is available.
 * @param opts.id Target agent identifier.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        id: string;
    },
): Promise<{ cancelled: boolean }> {
    const active=await ctx.fns.agent.triggers({id:opts.id,status:"active"});let cancelled=false;for(const trigger of active)if(trigger.kind==="at"){const result=await ctx.fns.agent.cancelTrigger({id:opts.id,triggerId:String(trigger.id)});cancelled=cancelled||result.cancelled;}return{cancelled};
}
