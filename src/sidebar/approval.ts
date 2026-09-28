/**
 * Render explicit local Hyper approval for a pending browser extension credential.
 *
 * Use for /sidebar/approve/:pairId. Existing password/session gate plus loopback, same-origin form POST, CSRF nonce and frame denial prevent silent website approval. In password-free deployments explicit local approval is the trust boundary.
 * @param opts.req Incoming approval page GET or explicit form POST request.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming approval page GET or explicit form POST request. */
        req: Request;
    },
): Promise<Response> {
    const u=new URL(opts.req.url);const id=u.pathname.slice('/sidebar/approve/'.length);const headers={'cache-control':'no-store','content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'x-frame-options':'DENY'};
    try{
    // GET has no Origin, so validate transport with a same-origin copy.
    const transportHeaders=new Headers(opts.req.headers);if(!transportHeaders.has('origin'))transportHeaders.set('origin',u.origin);
    await ctx.fns.sidebar.requestOrigin({req:new Request(opts.req,{headers:transportHeaders}),extension:false});
    if(opts.req.method==='POST'&&!opts.req.headers.get('origin'))return new Response('Origin rejected',{status:403,headers});
    if(await ctx.fns.auth.oidcOnly({})){if(!(await ctx.fns.auth.currentUser({req:opts.req})).user)return new Response(null,{status:303,headers:{location:'/auth/login?next='+encodeURIComponent(u.pathname),'cache-control':'no-store'}});}
    else if(await ctx.fns.auth.password({})){if(!await ctx.fns.procs.auth.authenticate({req:opts.req}))return new Response(null,{status:303,headers:{location:'/auth/login?next='+encodeURIComponent(u.pathname),'cache-control':'no-store'}});}
    if(!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found',{status:404,headers});
    await ctx.fns.sidebar.ensureSchema({});const[pair]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_pairs WHERE id=?',params:[id]});if(!pair||pair.revoked||Number(pair.expires_at)<Date.now())return new Response('Pair request expired',{status:410,headers});
    if(opts.req.method==='POST'){
     const data=await opts.req.formData();if(String(data.get('nonce')??'')!==pair.nonce||String(data.get('approve')??'')!=='yes')return new Response('Approval rejected',{status:403,headers});
     await ctx.fns.procs.db.run({sql:'UPDATE sidebar_pairs SET approved=true,expires_at=? WHERE id=? AND revoked=false',params:[Date.now()+30*86400000,id]});
     return new Response('<h1>Extension approved</h1><p>Return to the Hyper side panel. This tab can be closed.</p>',{headers});
    }
    if(opts.req.method!=='GET')return new Response('Method not allowed',{status:405,headers});
    return new Response('<!doctype html><title>Approve Hyper extension</title><h1>Connect browser extension?</h1><p>Extension: <code>'+Bun.escapeHTML(pair.origin)+'</code></p><p>Only approve if you just requested this connection from your Hyper extension. It may create chats, update tab context and close its bindings for 30 days. This is a trusted-local-user prototype, not a sandbox. Chat still uses your existing Hyper login.</p><form method="post"><input type="hidden" name="nonce" value="'+Bun.escapeHTML(pair.nonce)+'"><button name="approve" value="yes">Approve extension</button></form>',{headers});
    }catch{return new Response('Approval rejected',{status:403,headers});}
}
