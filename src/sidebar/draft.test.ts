import {test,expect} from 'bun:test';
import {mkTestCtx} from '../_testCtx.entry';

test('draft bind/context/reopen creates nothing; concurrent first submit binds once before enqueue with current title/default',async()=>{
 const ctx:any=await mkTestCtx();
 ctx.state.procs.http??={};ctx.state.procs.http.server={server:{requestIP:()=>({address:'127.0.0.1'})}};
 const reg=ctx.state.registry;reg.auth.password=async()=>null;
 let title='Before navigation',model='mock:first',starts=0,sends=0;
 reg.settings.modelDefault=async()=>model;
 reg.sidebar.targetSnapshot=async()=>({browserId:'browser',url:'https://example.test',title});
 const originalStart=reg.agent.start;
 reg.agent.start=async(c:any,s:any,o:any)=>{starts++;await Bun.sleep(30);return originalStart(c,s,o);};
 // Exercise the real durable message/event/enqueue pipeline without waking a worker.
 reg.agent.wakeWorker=()=>{};
 const originalAccept=reg.agent.acceptMessage;
 reg.agent.acceptMessage=async(c:any,s:any,o:any)=>{
  sends++;const[b]=await ctx.fns.procs.db.select({sql:'SELECT * FROM sidebar_bindings WHERE agent_id=?',params:[o.params.id]});expect(b.state).toBe('active');
  const[a]=await ctx.fns.procs.db.select({sql:'SELECT next_run_at FROM agents WHERE id=?',params:[o.params.id]});expect(a.next_run_at).toBeNull();
  return originalAccept(c,s,o);
 };
 const ext='chrome-extension://'+'b'.repeat(32);
 const api=async(action:string,body:object,token?:string)=>ctx.fns.sidebar.bridge({req:new Request('http://localhost:3010/sidebar/api/'+action,{method:'POST',headers:{origin:ext,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)})});
 const pair=await(await api('pair',{})).json();
 await ctx.fns.procs.db.run({sql:'UPDATE sidebar_pairs SET approved=true WHERE id=?',params:[pair.pairId]});
 const identity={browserEpoch:'epoch-123456789012',tabId:10,targetId:'target'};
 const binding=await(await api('bind',identity,pair.token)).json();expect(binding.agentId).toBeNull();
 await api('context',identity,pair.token);await api('bind',identity,pair.token);expect(starts).toBe(0);
 const request=(method='GET',origin='http://localhost:3010',extra:Record<string,string>={})=>new Request(binding.frameUrl,{method,headers:{...(method==='POST'?{origin,'hx-request':'true'}:{}),...extra},...(method==='POST'?{body:new URLSearchParams({text:'Explain this page'})}:{})});
 // Render the real shell and shared composer; no agent placeholder exists.
 const page=await ctx.fns.sidebar.draft({req:request()});expect(page.status).toBe(200);const html=await page.text();expect(html).toContain('id="chat-panel"');expect(html).toContain('id="form"');expect(html).toContain('Before navigation');expect(html).toContain('mock:first');expect(html).not.toContain('Browser:');expect(starts).toBe(0);
 expect((await ctx.fns.sidebar.draft({req:request('POST','https://evil.test')})).status).toBe(403);
 expect((await ctx.fns.sidebar.draft({req:request('POST','http://localhost:3010',{authorization:'Bearer '+pair.token})})).status).toBe(403);
 const realCurrentUser=reg.auth.currentUser;reg.auth.currentUser=async()=>({user:null,required:true});
 expect((await ctx.fns.sidebar.draft({req:request('POST')})).status).toBe(303);expect(starts).toBe(0);reg.auth.currentUser=realCurrentUser;
 title='Current title';model='mock:current';
 const replies=await Promise.all([ctx.fns.sidebar.draft({req:request('POST')}),ctx.fns.sidebar.draft({req:request('POST')})]);
 expect(replies.map(r=>r.status)).toEqual([200,200]);expect(replies[0].headers.get('HX-Redirect')).toBe(replies[1].headers.get('HX-Redirect'));expect(starts).toBe(1);expect(sends).toBe(1);
 const bound=await(await api('bind',identity,pair.token)).json();expect(bound.agentId).toBeString();
 const a=await ctx.fns.session.load({id:bound.agentId});expect(a.model).toBe('mock:current');expect(a.title).toBe('Current title');
 expect((await ctx.fns.session.getMessages({id:a.id})).filter((m:any)=>m.role==='user')).toHaveLength(1);
 expect((await ctx.fns.sidebar.draft({req:request('POST')})).status).toBe(200);expect(sends).toBe(1);expect(starts).toBe(1);
 await api('revoke',{},pair.token);expect((await ctx.fns.sidebar.draft({req:request()})).status).toBe(410);expect((await ctx.fns.sidebar.draft({req:request('POST')})).status).toBe(410);expect(starts).toBe(1);
});
