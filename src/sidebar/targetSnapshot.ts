/**
 * Verify an exact page target against local Chrome CDP.
 *
 * Use for binding and guards; never matches by URL or active page. Includes browser process identity for restart detection.
 * @param opts.targetId Exact chrome.debugger target identifier.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact chrome.debugger target identifier. */
        targetId: string;
    },
): Promise<{browserId:string;url:string;title:string}> {
    const get=async(path:string)=>{const base=ctx.fns.procs.env.cdpUrl({});const r=await fetch(base+path,{signal:AbortSignal.timeout(3000),redirect:'error'});if(!r.ok)throw new Error('cdp_unavailable');return await r.json();};const v=await get('/json/version') as {webSocketDebuggerUrl?:string};const list=await get('/json/list') as Array<{id:string;type:string;url?:string;title?:string}>;const browserId=String(v.webSocketDebuggerUrl??'').split('/devtools/browser/')[1];const t=Array.isArray(list)?list.find(t=>t.id===opts.targetId&&t.type==='page'):null;if(!browserId||!t)throw new Error('target_unavailable');return{browserId,url:String(t.url??'').slice(0,8192),title:String(t.title??'').slice(0,512)};
}
