/** Compute daily medication-record gaps; each gap returns its own actual-time confirmation form.
 * Submit delegates only to the private trusted intake handler. Preview never writes or imports.
 */
export default async function(ctx:Context, _session:Session|null, opts:types.flow.FlowRequest):Promise<types.flow.FlowOutput> {
    if(opts.mode==='apply') throw new Error('Actual intake requires explicit form confirmation');
    if(opts.mode==='submit') return await ctx.fns.myhealthGaps.submitMedication({request:opts});
    const data=await ctx.fns.myhealthGaps.medicationContext({});
    return {gaps:await ctx.fns.myhealthGaps.medicationRecordGaps({now:opts.now,...data})};
}
