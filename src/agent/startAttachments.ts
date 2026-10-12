/**
 * Starts declared producers that have active subscriptions
 *
 * Reconcile $attach producer declarations with durable subscriptions and start each needed producer once. Use at agent runtime startup, after attaching, and after hot reload.
 * @param opts.source Optional single source to reconcile.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional single source to reconcile. */
        source?: string;
    },
): Promise<{ started: string[] }> {
    const root=((ctx.state as any).attachments??={declarations:{},running:{}}),started:string[]=[];const sources=opts.source?[String(opts.source)]:Object.keys(root.declarations??{});for(const source of sources){if(root.running?.[source])continue;const active=(await ctx.fns.procs.db.select({sql:"SELECT 1 FROM agent_attachments WHERE source=? AND status='active' LIMIT 1",params:[source]}))[0];if(!active)continue;const declaration=root.declarations?.[source];if(!declaration)continue;const controller=new AbortController();const emit=async(event:any)=>await ctx.fns.agent.emitAttachment({source,eventId:String(event.eventId),eventType:String(event.eventType),payload:event.payload??{},occurredAt:event.occurredAt});try{const handle=await declaration.start({ctx,emit,signal:controller.signal});root.running[source]={controller,handle,declaration};started.push(source);}catch(error:any){controller.abort();await ctx.fns.procs.log.warn({event:"attachment.start.failed",msg:`${source}: ${error?.message??error}`});}}return{started};
}
