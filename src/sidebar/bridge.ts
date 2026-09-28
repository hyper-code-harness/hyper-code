/**
 * Handle the narrow browser extension pairing and tab binding HTTP API.
 *
 * Use only for /sidebar/api paths. Requires validated local socket and extension Origin, issues pending hashed tokens, validates CDP targets, and creates durable draft tab mappings without creating agents. Not a sandbox.
 * @param opts.req Incoming request for the dedicated sidebar API.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming request for the dedicated sidebar API. */
        req: Request;
    },
): Promise<Response> {
    const u=new URL(opts.req.url);const action=u.pathname.slice('/sidebar/api/'.length);let origin='';const headers:Record<string,string>={'cache-control':'no-store','vary':'Origin'};
    const reply=(value:object,status=200)=>Response.json(value,{status,headers});
    try{
     origin=await ctx.fns.sidebar.requestOrigin({req:opts.req,extension:true});headers['access-control-allow-origin']=origin;headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='authorization, content-type';
     if(opts.req.method==='OPTIONS')return new Response(null,{status:204,headers});
     if(opts.req.method!=='POST'||!['pair','status','bind','context','detach','close','revoke'].includes(action))return reply({error:'not_found'},404);
     if(!(opts.req.headers.get('content-type')??'').startsWith('application/json'))return reply({error:'json_required'},400);
     const raw=await opts.req.text();if(raw.length>16384)return reply({error:'body_too_large'},413);const body=JSON.parse(raw) as Record<string,string|number>;if(!body||Array.isArray(body)||typeof body!=='object')return reply({error:'invalid_body'},400);
     await ctx.fns.sidebar.ensureSchema({});const now=Date.now();const hash=(v:string)=>new Bun.CryptoHasher('sha256').update(v).digest('hex');
     if(action==='pair'){
      const [count]=await ctx.fns.procs.db.select({sql:'SELECT count(*) AS n FROM sidebar_pairs WHERE expires_at>? AND approved=false',params:[now]});if(Number(count.n)>50)return reply({error:'too_many_pending'},429);
      const pairId=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),expiresAt=now+600000;
      await ctx.fns.procs.db.run({sql:'INSERT INTO sidebar_pairs(id,token_hash,origin,expires_at,nonce) VALUES(?,?,?,?,?)',params:[pairId,hash(token),origin,expiresAt,crypto.randomUUID()]});
      return reply({pairId,token,expiresAt,approvalUrl:u.origin+'/sidebar/approve/'+pairId});
     }
     const token=/^Bearer ([A-Za-z0-9-]{72})$/.exec(opts.req.headers.get('authorization')??'')?.[1];if(!token)return reply({error:'unauthorized'},401);
     const[pair]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_pairs WHERE token_hash=? AND origin=?',params:[hash(token),origin]});
     if(!pair)return reply({error:'unauthorized'},401);
     if(action==='revoke'){await ctx.fns.procs.db.run({sql:'UPDATE sidebar_pairs SET revoked=true WHERE id=?',params:[pair.id]});await ctx.fns.procs.db.run({sql:"UPDATE sidebar_bindings SET state='revoked' WHERE pair_id=?",params:[pair.id]});return reply({revoked:true});}
     if(Number(pair.expires_at)<now)return reply({error:'unauthorized'},401);
     if(action==='status')return reply({approved:pair.approved,revoked:pair.revoked});
     if(pair.revoked||!pair.approved)return reply({error:'pair_not_approved'},403);
     const epoch=body.browserEpoch,tab=body.tabId,target=body.targetId;
     if(typeof epoch!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(epoch)||!Number.isSafeInteger(tab)||Number(tab)<1)return reply({error:'invalid_tab_identity'},400);
     let[b]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_bindings WHERE pair_id=? AND browser_epoch=? AND tab_id=?',params:[pair.id,epoch,tab]});
     if(action==='close'){
      await ctx.fns.procs.db.run({sql:"INSERT INTO sidebar_bindings(id,pair_id,browser_epoch,tab_id,target_id,browser_id,state) VALUES(?,?,?,?,?,?,'closed') ON CONFLICT(pair_id,browser_epoch,tab_id) DO UPDATE SET state='closed'",params:[crypto.randomUUID(),pair.id,epoch,tab,'','']});return reply({closed:true});
     }
     if(typeof target!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(target))return reply({error:'invalid_target'},400);
     if(b&&(b.state!=='active'||b.target_id!==target))return reply({error:'binding_conflict'},409);
     if(!b&&action==='context')return reply({error:'binding_not_found'},409);
     const snapshot=await ctx.fns.sidebar.targetSnapshot({targetId:target});
     if(b&&b.browser_id!==snapshot.browserId){await ctx.fns.procs.db.run({sql:"UPDATE sidebar_bindings SET state='revoked' WHERE id=?",params:[b.id]});return reply({error:'browser_restarted'},409);}
     if(action==='detach'){
      if(!b||b.state!=='active'||b.target_id!==target)return reply({error:'binding_conflict'},409);
      await ctx.fns.procs.db.run({sql:"UPDATE sidebar_bindings SET agent_id=NULL,first_send_state='draft',url=?,title=? WHERE id=? AND state='active'",params:[snapshot.url,snapshot.title,b.id]});
      return reply({agentId:null,bindingId:b.id,targetId:target,frameUrl:u.origin+'/sidebar/draft/'+b.id+'?presentation=sidebar'});
     }
     if(!b){await ctx.fns.procs.db.run({sql:'INSERT INTO sidebar_bindings(id,pair_id,browser_epoch,tab_id,target_id,browser_id,url,title) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(pair_id,browser_epoch,tab_id) DO NOTHING',params:[crypto.randomUUID(),pair.id,epoch,tab,target,snapshot.browserId,snapshot.url,snapshot.title]});[b]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_bindings WHERE pair_id=? AND browser_epoch=? AND tab_id=?',params:[pair.id,epoch,tab]});}
     if(b.state!=='active'||b.target_id!==target||b.browser_id!==snapshot.browserId)return reply({error:'binding_conflict'},409);
     await ctx.fns.procs.db.run({sql:"UPDATE sidebar_bindings SET url=?,title=?,context_revision=context_revision+1 WHERE id=? AND state='active'",params:[snapshot.url,snapshot.title,b.id]});
     const[current]=await ctx.fns.procs.db.select({sql:'SELECT b.state,p.revoked FROM sidebar_bindings b JOIN sidebar_pairs p ON p.id=b.pair_id WHERE b.id=?',params:[b.id]});if(current.state!=='active'||current.revoked)return reply({error:'binding_revoked'},409);
     return reply({agentId:b.agent_id,bindingId:b.id,targetId:target,frameUrl:u.origin+(b.agent_id?'/agent/'+b.agent_id:'/sidebar/draft/'+b.id)+'?presentation=sidebar'});
    }catch(e){const error=e instanceof Error?e.message:'bridge_error';return reply({error:['trusted_transport_required','origin_rejected','target_unavailable','cdp_unavailable'].includes(error)?error:'bridge_error'},error==='trusted_transport_required'||error==='origin_rejected'?403:error.includes('target')||error.includes('cdp')?502:400);}
}
