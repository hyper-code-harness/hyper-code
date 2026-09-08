/**
 * Previews needs or applies one freshly rechecked target and records its receipt
 *
 * Use preview or explain for read-only discovery. Apply requires id and revision, reserves a receipt before calling one action, then independently verifies whether the need remains. Actions must implement transactional rechecks and idempotency.
 * @param opts.flow Registered gap declaration name.
 * @param opts.mode Requested read or single-target write operation.
 * @param opts.now ISO clock fixed across all phases; defaults to current time.
 * @param opts.target Stable business identity and exact revision, required for explain and apply.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Registered gap declaration name. */
        flow: string;
        /** Requested read or single-target write operation. */
        mode: 'preview'|'explain'|'apply';
        /** ISO clock fixed across all phases; defaults to current time. */
        now?: string;
        /** Stable business identity and exact revision, required for explain and apply. */
        target?: {id:string; revision:string};
    },
): Promise<types.flow.ReconcileResult> {
    if(!['preview','explain','apply'].includes(opts.mode)) throw new Error('Invalid mode');
    if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(opts.flow)) throw new Error('Invalid flow name');
    if(opts.mode!=='preview' && (!opts.target || typeof opts.target.id!=='string' || !opts.target.id.trim() || opts.target.id.length>1024 || typeof opts.target.revision!=='string' || !opts.target.revision.trim() || opts.target.revision.length>1024)) throw new Error('Target id and revision required');
    const time = opts.now===undefined ? Date.now() : Date.parse(opts.now);
    if(!Number.isFinite(time)) throw new Error('Invalid now');
    const now=new Date(time).toISOString();
    const result:types.flow.ReconcileResult={id:crypto.randomUUID(),flow:opts.flow,now,mode:opts.mode,target:opts.target,gaps:[],status:'failed',actionCalled:false,verified:false,converged:false,before:0,after:0,effects:[],trace:[]};
    // Fail closed if storage is unavailable. A crash leaves this honest pending receipt.
    if(opts.mode==='apply') await ctx.fns.procs.db.run({sql:'INSERT INTO flow.receipts(id,flow,result) VALUES (?,?,?::jsonb)',params:[result.id,opts.flow,JSON.stringify({...result,error:'Attempt started; completion not recorded'})]});
    let phase='discover';
    try {
     if(opts.mode==='apply') await ctx.fns.flow.refresh({});
     result.gaps=await ctx.fns.flow.discover({flow:opts.flow,now});
     result.before=result.after=result.gaps.length;
     result.trace.push({phase});
     if(opts.mode==='preview') {result.status='preview'; result.converged=result.gaps.length===0; return result;}
     const gap=result.gaps.find(g=>g.id===opts.target!.id);
     if(!gap || gap.revision!==opts.target!.revision) result.status='stale';
     else if(opts.mode==='explain') {result.status='explained';result.explanation=gap.summary+(gap.will ? ' → '+gap.will : '');}
     else {
      if(!gap.will) throw new Error('This gap has no available action');
      phase='apply'; result.actionCalled=true;
      const output=await ctx.state.flow.declarations[opts.flow]!.fn(ctx,session,{mode:'apply',now,target:opts.target!});
      result.effects=output?.effects??[]; result.trace.push({phase});
      phase='verify'; result.gaps=await ctx.fns.flow.discover({flow:opts.flow,now});
      result.after=result.gaps.length;result.verified=true;result.converged=result.after===0;
      result.status=result.gaps.some(g=>g.id===opts.target!.id)?'remains':'closed';result.trace.push({phase});
     }
    } catch(error) {result.status='failed';result.error=String(error instanceof Error?error.message:error);result.trace.push({phase,error:result.error});}
    if(opts.mode==='apply') await ctx.fns.procs.db.run({sql:'UPDATE flow.receipts SET result=?::jsonb WHERE id=?',params:[JSON.stringify(result),result.id]});
    return result;
}
