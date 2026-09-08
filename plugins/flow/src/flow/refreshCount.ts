/**
 * Refresh the cached aggregate gap count using read-only previews
 *
 * Use from the five-minute cron or after gap actions. Concurrent calls share one preview. Retains the last complete count on partial or total failures and publishes only aggregate freshness metadata.
 * @param opts.force Bypass the five-minute attempt TTL after an explicit gap change. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Bypass the five-minute attempt TTL after an explicit gap change. @default false */
        force?: boolean;
    },
): Promise<types.flow.CountSnapshot> {
    const state=ctx.state.flow??=( {declarations:{}} );
    if(state.countRefresh)return state.countRefresh;
    if(!opts.force && state.countCache && Date.now()-state.countCache.attemptedAt<300000)return state.countCache;
    const work=(async()=>{
     const previous=state.countCache;
     let count=previous?.count??null,checkedAt=previous?.checkedAt??null,partial=false,stale=true;
     try { const rows=await ctx.fns.flow.list({}); partial=rows.some(row=>Boolean(row.result.error)||row.result.status==='failed');
     if(!partial){count=rows.reduce((sum,row)=>sum+row.result.gaps.length,0);checkedAt=Date.now();stale=false;}
     } catch { /* Keep the last complete count; failure is never an all-clear. */ }
     const snapshot:types.flow.CountSnapshot={count,checkedAt,attemptedAt:Date.now(),stale,partial};
     state.countCache=snapshot;
     ctx.fns.procs.events.emit({event:{type:'flow.count',...snapshot}});
     return snapshot;
    })();
    state.countRefresh=work;
    try{return await work;}finally{delete state.countRefresh;}
}
