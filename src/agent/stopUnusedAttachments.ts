/**
 * Stops producers that no longer have active subscriptions
 *
 * Reconcile running attachment producers and stop those with no active durable subscribers, or all producers during shutdown.
 * @param opts.source Optional source to reconcile.
 * @param opts.all Stop every running producer regardless of subscriptions. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Optional source to reconcile. */
        source?: string;
        /** Stop every running producer regardless of subscriptions. @default false */
        all?: boolean;
    },
): Promise<{ stopped: string[] }> {
    const root=(ctx.state as any).attachments;if(!root?.running)return{stopped:[]};const sources=opts.source?[String(opts.source)]:Object.keys(root.running),stopped:string[]=[];for(const source of sources){const running=root.running[source];if(!running)continue;const active=opts.all?null:(await ctx.fns.procs.db.select({sql:"SELECT 1 FROM agent_attachments WHERE source=? AND status='active' LIMIT 1",params:[source]}))[0];if(active)continue;running.controller?.abort();try{if(typeof running.handle?.stop==="function")await running.handle.stop();else if(typeof running.declaration?.stop==="function")await running.declaration.stop(running.handle);}catch(error:any){await ctx.fns.procs.log.warn({event:"attachment.stop.failed",msg:`${source}: ${error?.message??error}`});}delete root.running[source];stopped.push(source);}return{stopped};
}
