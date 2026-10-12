// The document of an html canvas tab, served by GET /canvas/:id/item/:itemId/frame. Isolation does not
// depend on the page's own markup: the response carries a CSP header with a `sandbox` directive (opaque
// origin even when the URL is opened directly — no cookies, no reach into the app) and a short host
// allow-list, so the page cannot fetch, post or load images from arbitrary servers.

/** Hosts a page may load scripts, styles, fonts and images from. Everything else is blocked. */
const CDNS = "https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://esm.sh";
const CSP = [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${CDNS}`,
    `style-src 'unsafe-inline' ${CDNS}`,
    `font-src data: ${CDNS}`,
    "img-src data: blob:",
    "media-src data: blob:",
    "worker-src blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads",
].join("; ");

const json = (value: unknown) => JSON.stringify(value ?? null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * Builds the response for an html canvas tab's frame: the page with the window.hyper bridge, its state and
 * fresh `load` data, under a sandboxing CSP header.
 * @param opts.agentId Agent whose canvas holds the tab.
 * @param opts.itemId The html tab.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas holds the tab. */
    agentId: string;
    /** The html tab. */
    itemId: number;
}): Promise<Response> {
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
    const item = (await ctx.fns.canvas.list({ agentId: opts.agentId })).find(i => i.id === Number(opts.itemId));
    if (!item || item.kind !== "html") return new Response("no such html tab", { status: 404, headers });
    let data: unknown = null;
    if (item.args.load) {
        try { data = await ctx.fns.canvas.runLoad({ source: String(item.args.load) }); }
        catch (error: any) {
            const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
            return new Response(`<!doctype html><meta charset="utf-8"><body style="font:13px system-ui;padding:16px"><p style="color:#b91c1c">load: ${esc(String(error?.message ?? error))}</p><pre style="white-space:pre-wrap;color:#666">${esc(String(item.args.load))}</pre>`, { headers });
        }
    }
    // The bridge comes first, as its own document head, so it runs before any page script.
    const bridge = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{font-family:system-ui,sans-serif}</style><script>(()=>{let state=${json(item.state)};const listeners=[];const send=m=>parent.postMessage(Object.assign({hyperCanvas:1},m),'*');
window.hyper=Object.freeze({get state(){return state},data:${json(data)},
setState(patch){if(!patch||typeof patch!=='object')throw new Error('hyper.setState: pass an object');state=Object.fromEntries(Object.entries({...state,...patch}).filter(([,v])=>v!==null));send({type:'state',state:patch});},
ping(text,data){send({type:'ping',text:String(text??''),data});},
onState(fn){listeners.push(fn);}});
addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.hyperCanvas!==1||e.data.type!=='state')return;state=e.data.state||{};for(const fn of listeners){try{fn(state)}catch(err){console.error(err)}}});
addEventListener('error',e=>send({type:'error',message:String(e.message||e.error||'error')}));})();</script></head><body>`;
    return new Response(bridge + String(item.args.html ?? "") + "</body></html>", { headers });
}
