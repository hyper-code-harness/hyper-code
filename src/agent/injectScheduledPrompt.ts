/**
 * Injects a scheduled prompt into one agent transcript
 *
 * Append a fixed cron-delivered prompt as a real cursor-visible user message, render its chat event, schedule the durable agent worker, and emit live UI refreshes. Use as the target of recurring Agent schedules.
 * @param opts.agentId Target agent identifier.
 * @param opts.text Fixed prompt injected on each schedule occurrence.
 * @param opts.scheduleId Stable schedule name recorded on the message.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target agent identifier. */
        agentId: string;
        /** Fixed prompt injected on each schedule occurrence. */
        text: string;
        /** Stable schedule name recorded on the message. */
        scheduleId?: string;
    },
): Promise<{ agentId: string; messageIdx: number; scheduled: true }> {
    const id=String(opts.agentId??"").trim(),text=String(opts.text??"").trim();
    if(!id)throw new Error("agentId is required");if(!text)throw new Error("scheduled prompt is empty");if(text.length>20000)throw new Error("scheduled prompt exceeds 20000 characters");
    const row=((await ctx.fns.procs.db.select({sql:"SELECT id FROM agents WHERE id=? AND archived_at IS NULL",params:[id]}))as any[])[0];if(!row)throw new Error(`agent not found: ${id}`);
    const message=await ctx.fns.session.appendUserMessage({id,text});
    const now=Date.now();await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=COALESCE(next_run_at,?),updated_at=? WHERE id=? AND archived_at IS NULL",params:[now,now,id]});
    const live=(ctx.state as any).agent?.[id];if(live)await ctx.fns.session.syncAgentState({agent:live});
    ctx.fns.events.refreshAgentMeta({agentId:id,section:"automation",reason:"scheduled-prompt"});ctx.fns.agent.wakeWorker({});return{agentId:id,messageIdx:message.idx,scheduled:true};
}
