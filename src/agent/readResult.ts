/**
 * Read a bounded range of a stored tool result visible to the calling agent
 *
 * Authorizes a UUID against current visible message history including fork boundaries on every read, even cache hits. Foreign and unknown UUIDs return not_found. Legacy rN references are unavailable. Offsets and limits count JavaScript UTF-16 code units; maximum output is 16000 units. No file deletion is enabled, so expired is reserved for future tombstones.
 * @param opts.id Immutable result UUID from a tool message; old rN aliases return legacy_unavailable.
 * @param opts.offset Starting JavaScript UTF-16 string position. @default 0 @minimum 0
 * @param opts.limit Maximum JavaScript UTF-16 units returned. @default 4000 @minimum 1 @maximum 16000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Immutable result UUID from a tool message; old rN aliases return legacy_unavailable. */
        id: string;
        /** Starting JavaScript UTF-16 string position. @default 0 @minimum 0 */
        offset?: number;
        /** Maximum JavaScript UTF-16 units returned. @default 4000 @minimum 1 @maximum 16000 */
        limit?: number;
    },
): Promise<{ok:true;text:string;totalChars:number;offset:number;truncated:boolean}|{ok:false;error:'legacy_unavailable'|'expired'|'not_found'|'forbidden'|'corrupt'|'too_large'}> {
    if (/^r[0-9]+$/.test(opts.id)) return {ok:false,error:'legacy_unavailable'};
    let caller; try {caller=await ctx.fns.agent.current({});} catch {return {ok:false,error:'forbidden'};}
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(opts.id)) return {ok:false,error:'not_found'};
    const messages = await ctx.fns.session.getFullMessages({id:caller.id});
    const ref = messages.find((message)=>message.result_ref?.id===opts.id)?.result_ref as types.agent.ResultRef | undefined;
    if (!ref) return {ok:false,error:'not_found'};
    const offset = Number.isFinite(opts.offset) ? Math.max(0,Math.trunc(opts.offset!)) : 0;
    const limit = Number.isFinite(opts.limit) ? Math.min(16000,Math.max(1,Math.trunc(opts.limit!))) : 4000;
    try {
     const result = await ctx.fns.resultStore.read({ref});
     const start = Math.min(offset,result.totalChars);
     const text=result.text.slice(start,start+limit);
     return {ok:true,text,totalChars:result.totalChars,offset:start,truncated:start+text.length<result.totalChars};
    } catch (error) {
     const message = error instanceof Error ? error.message : '';
     return {ok:false,error:message==='too_large'?'too_large':message==='not_found'?'not_found':'corrupt'};
    }
}
