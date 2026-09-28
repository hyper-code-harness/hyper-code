import { expect, test } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';
import requestOrigin from './requestOrigin';

const origin='chrome-extension://'+'a'.repeat(32);
function req(path:string, body:object={},token?:string){return new Request('http://localhost:3010/sidebar/'+path,{method:'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});}

test('sidebar origin rejects remote, missing and forwarded requests',async()=>{
 const c:any={state:{procs:{http:{server:{server:{requestIP:()=>({address:'127.0.0.1'})}}}}}};
 expect(await requestOrigin(c,null,{req:req('api/pair'),extension:true})).toBe(origin);
 for(const r of [new Request('http://localhost:3010/sidebar/api/pair'),new Request('http://evil.test/sidebar/api/pair',{headers:{origin}}),new Request('http://localhost:3010/sidebar/api/pair',{headers:{origin,'x-forwarded-host':'localhost'}}),new Request('http://localhost:3010/sidebar/api/pair',{headers:{origin:'https://evil.test'}})])await expect(requestOrigin(c,null,{req:r,extension:true})).rejects.toThrow();
 c.state.procs.http.server.server.requestIP=()=>({address:'192.168.1.2'});
 await expect(requestOrigin(c,null,{req:req('api/pair'),extension:true})).rejects.toThrow('trusted_transport');
});

test('sidebar explicit approval, durable identity, context, restart and close',async()=>{
 const ctx:any=await mkTestCtx();
 ctx.state.procs.http??={};ctx.state.procs.http.server={server:{requestIP:()=>({address:'127.0.0.1'})}};
 let processId='process-1',title='First';
 ctx.state.registry.sidebar.targetSnapshot=async(_c:object,_s:object,{targetId}: {targetId:string})=>{if(targetId!=='target-A'&&targetId!=='target-B')throw new Error('target_unavailable');return{browserId:processId,url:'https://example.test/',title};};
 ctx.state.registry.auth.password=async()=>null;
 const call=async(action:string,body:object={},token?:string)=>ctx.fns.sidebar.bridge({req:req('api/'+action,body,token)});
 const pair=await (await call('pair')).json();expect(pair.token.length).toBe(72);
 expect((await call('bind',{browserEpoch:'epoch-123456789012',tabId:1,targetId:'target-A'},pair.token)).status).toBe(403);
 const[p]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_pairs WHERE id=?',params:[pair.pairId]});expect(p.token_hash).not.toBe(pair.token);
 const approve=async(nonce:string,site='http://localhost:3010')=>ctx.fns.sidebar.approval({req:new Request(pair.approvalUrl,{method:'POST',headers:{origin:site},body:new URLSearchParams({nonce,approve:'yes'})})});
 expect((await approve(p.nonce,'https://evil.test')).status).toBe(403);
 expect((await approve('bad')).status).toBe(403);
 expect((await approve(p.nonce)).status).toBe(200);
 const identity={browserEpoch:'epoch-123456789012',tabId:1,targetId:'target-A'};
 const b=await(await call('bind',identity,pair.token)).json();expect(b.agentId).toBeNull();expect(b.frameUrl).toContain('/sidebar/draft/');expect(b.frameUrl).toEndWith('?presentation=sidebar');
 expect((await(await call('bind',identity,pair.token)).json()).agentId).toBe(b.agentId);
 expect((await call('bind',{...identity,targetId:'target-B'},pair.token)).status).toBe(409);
 // Existing bound agents retain their identity and guards; draft binds never create one.
 const existing=await ctx.fns.agent.start({model:'mock:echo'});b.agentId=existing.id;
 await ctx.fns.procs.db.run({sql:'UPDATE sidebar_bindings SET agent_id=? WHERE id=?',params:[existing.id,b.bindingId]});
 expect((await(await call('bind',identity,pair.token)).json()).agentId).toBe(existing.id);
 title='Navigation';const info=await ctx.fns.sidebar.bindingForAgent({agentId:b.agentId});expect(info.title).toBe('Navigation');expect(info.cdpSessionName).toBe('sidebar:'+b.bindingId);
 expect((await call('close',identity,pair.token)).status).toBe(200);expect((await call('bind',identity,pair.token)).status).toBe(409);expect((await ctx.fns.sidebar.bindingForAgent({agentId:b.agentId})).state).toBe('closed');
 const second=await(await call('bind',{...identity,tabId:2},pair.token)).json();expect(second.agentId).toBeNull();processId='process-2';expect((await call('context',{...identity,tabId:2},pair.token)).status).toBe(409);
 expect((await call('revoke',{},pair.token)).status).toBe(200);expect((await call('bind',{...identity,tabId:3},pair.token)).status).toBe(403);
 const pending=await(await call('pair')).json();
 expect((await call('revoke',{},pending.token)).status).toBe(200);
 expect((await call('revoke',{},pending.token)).status).toBe(200);
 const expired=await(await call('pair')).json();await ctx.fns.procs.db.run({sql:'UPDATE sidebar_pairs SET expires_at=0 WHERE id=?',params:[expired.pairId]});
 expect((await call('status',{},expired.token)).status).toBe(401);
 expect((await call('revoke',{},expired.token)).status).toBe(200);
 expect((await call('bind',{...identity,tabId:3},expired.token)).status).toBe(401);
 const unknown=await call('bind',{...identity,targetId:'missing'},pair.token);expect(unknown.status).toBe(403);
 expect((await ctx.fns.sidebar.bindingForAgent({agentId:'missing'}))).toBeNull();
 const msgs=await ctx.fns.session.getMessages({id:b.agentId});expect(msgs).toHaveLength(0);
});
