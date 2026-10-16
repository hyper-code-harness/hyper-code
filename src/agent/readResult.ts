/**
 * Read a bounded range of a stored tool or trigger result visible to the calling agent
 *
 * Authorizes a UUID against current visible message history including fork boundaries, or the caller's own trigger run history, on every read, even cache hits. Foreign and unknown UUIDs return not_found. Legacy rN references are unavailable. Offsets and limits count JavaScript UTF-16 code units; maximum output is 16000 units. No file deletion is enabled, so expired is reserved for future tombstones.
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
    const offset = Number.isFinite(opts.offset) ? Math.max(0,Math.trunc(opts.offset!)) : 0;
    const limit = Number.isFinite(opts.limit) ? Math.min(16000,Math.max(1,Math.trunc(opts.limit!))) : 4000;
    try {
     const result = await ctx.fns.resultStore.read({id:opts.id});
     const start = Math.min(offset,result.totalChars);
     const text=result.text.slice(start,start+limit);
     return {ok:true,text,totalChars:result.totalChars,offset:start,truncated:start+text.length<result.totalChars};
    } catch (error) {
     const message = error instanceof Error ? error.message : '';
     return {ok:false,error:message==='forbidden'?'forbidden':message==='too_large'?'too_large':message==='not_found'?'not_found':'corrupt'};
    }
}
