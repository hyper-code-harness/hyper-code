/**
 * Delivers one claimed trigger prompt into its agent conversation
 *
 * Append a trigger-generated synthetic user prompt and schedule the target agent. The trigger claim token is rechecked immediately before delivery so cancellation prevents a stale worker from waking the agent.
 * @param opts.triggerId Claimed trigger identifier.
 * @param opts.claimToken Unique token proving ownership of the current claim.
 * @param opts.prompt Prompt to insert.
 * @param opts.now Delivery timestamp in milliseconds.
 * @param opts.resultRef Durable predicate result reference, attached only after successful storage.
 * @param opts.resultPreview Bounded predicate preview accompanying a stored reference.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Claimed trigger identifier. */
        triggerId: string;
        /** Unique token proving ownership of the current claim. */
        claimToken: string;
        /** Prompt to insert. */
        prompt: string;
        /** Delivery timestamp in milliseconds. */
        now: number;
        /** Durable predicate result reference, attached only after successful storage. */
        resultRef?: types.agent.ResultRef;
        /** Bounded predicate preview accompanying a stored reference. */
        resultPreview?: string;
    },
): Promise<boolean> {
    const row=(await ctx.fns.procs.db.select({sql:"SELECT agent_id FROM agent_triggers WHERE id=? AND status='checking' AND claim_token=?",params:[opts.triggerId,opts.claimToken]}))[0] as any;if(!row)return false;const message=await ctx.fns.session.appendMessage({id:String(row.agent_id),message:{role:"user",content:String(opts.prompt)+(opts.resultRef?`\n\nPredicate result preview: ${opts.resultPreview??""}\nFull result: await ctx.fns.agent.readResult({ id: "${opts.resultRef.id}", offset: 0, limit: 4000 })`:""),result_ref:opts.resultRef,message_type:"trigger",excluded_from_cursor:true}});await ctx.fns.session.appendEvent({id:String(row.agent_id),event:{type:"wake_up",reason:String(opts.prompt),messageIdx:message.idx,triggerId:opts.triggerId}});await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=COALESCE(next_run_at,?),updated_at=? WHERE id=? AND archived_at IS NULL",params:[opts.now,opts.now,row.agent_id]});const live=(ctx.state as any).agent?.[row.agent_id];if(live)await ctx.fns.session.syncAgentState({agent:live});ctx.fns.events.refreshAgentMeta({agentId:String(row.agent_id),section:"wake",reason:"trigger-delivered"});ctx.fns.agent.wakeWorker({});return true;
}
