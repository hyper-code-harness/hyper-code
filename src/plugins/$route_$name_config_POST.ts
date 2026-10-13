/** Saves only declared configuration fields of an already mounted plugin after same-origin and bounded-form checks. */
export default async function(ctx: Context, _session: Session | null, opts: {
    /** Incoming URL-encoded same-origin browser request; limited to 32 KiB. */ req: Request;
    /** Route parameters containing the mounted plugin name. */ params: Record<string,string>;
}): Promise<Response> {
    const req = opts.req;
    if (req.headers.get('origin') !== new URL(req.url).origin || req.headers.get('sec-fetch-site') === 'cross-site') return new Response('Same-origin request required', {status:403});
    if (req.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') return new Response('URL-encoded form required', {status:415});
    const max = 32768;
    if (Number(req.headers.get('content-length')) > max) return new Response('Form too large', {status:413});
    let text = '';
    if (req.body) {
        const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
            while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) { await reader.cancel(); return new Response('Form too large',{status:413}); } chunks.push(part.value); }
        } catch { return new Response('Invalid request body',{status:400}); }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;} text=new TextDecoder().decode(bytes);
    }
    const form = new URLSearchParams(text); const values: Record<string,string> = Object.create(null); let reset: string|undefined;
    for (const [key,value] of form) {
        if (key === 'reset') { if (reset !== undefined) return new Response('Duplicate form field',{status:400}); reset=value; }
        else { if(Object.hasOwn(values,key)) return new Response('Duplicate form field',{status:400}); values[key]=value; }
    }
    if(reset !== undefined && Object.keys(values).length) return new Response('Reset must be submitted alone',{status:400});
    try {
        await ctx.fns.plugins.saveConfiguration({name:opts.params.name!,...(reset !== undefined ? {reset} : {values})});
        return new Response(null,{status:303,headers:{Location:'/plugins/'+encodeURIComponent(opts.params.name!)+'?tab=settings&saved=1','Cache-Control':'no-store'}});
    } catch { return new Response('Configuration could not be saved. Use only declared editable fields with valid values; secrets must be managed in Secrets.',{status:400,headers:{'Cache-Control':'no-store'}}); }
}
