import {afterAll,beforeAll,expect,test} from "bun:test";
import {mkTestCtx} from "../_testCtx.entry";
let ctx:any;
const withSession=(session:any)=>{const c=Object.create(ctx);c.session=session;return c;};
const request=(id:string)=>withSession({req:new Request(`http://localhost/${id}`)});
const add=async(name:string,fn="testAuthority.inspect")=>ctx.fns.cron.add({name,fn,every:"1h",now:true});
const grant=async(name:string,owner="owner-a",fn="testAuthority.inspect")=>request(owner).fns.cron.grant({name,fn,scopes:["notification.enqueue"]});
const captured:any[]=[];
beforeAll(async()=>{
 ctx=await mkTestCtx();
 ctx.state.registry.auth.currentUser=async(_c:any,_s:any,o:any)=>({user:{id:new URL(o.req.url).pathname.slice(1)},required:true});
 ctx.state.registry.testAuthority={inspect:async(c:any,s:any)=>{captured.push({c,s});await Bun.sleep(5);return {authority:await c.fns.cron.authority({scope:"notification.enqueue"}),wrong:await c.fns.cron.authority({scope:"other"}),user:s.user??null,agent:s.agent??null};},fail:async(c:any,s:any)=>{captured.push({c,s});throw Error("test failure");}};
});
afterAll(async()=>{await ctx.fns.procs.db.close({});});
async function drain(){ctx.state.cron.running=true;const original=ctx.state.registry.cron.claim;ctx.state.registry.cron.claim=async(c:any,s:any,o:any)=>{const run=await original(c,s,o);if(!run)ctx.state.cron.running=false;return run;};try{await ctx.fns.cron.workerLoop({});}finally{ctx.state.registry.cron.claim=original;}}
test("grant rejects forged agent/system and unsupported scopes",async()=>{
 await add("grant-test");
 for(const s of [{kind:"system",user:{id:"owner-a"}},{agentId:"fake",req:new Request("http://localhost/owner-a")},{service:"cron",ownerId:"owner-a"}]){
  await expect(withSession(s).fns.cron.grant({name:"grant-test",fn:"testAuthority.inspect",scopes:["notification.enqueue"]})).rejects.toThrow();
  expect(await withSession(s).fns.cron.authority({scope:"notification.enqueue"})).toBeNull();
  await expect(withSession(s).fns.cron.runOne({id:1})).rejects.toThrow();
  await expect(withSession(s).fns.cron.workerLoop({})).rejects.toThrow();
 }
 await expect(request("owner-a").fns.cron.grant({name:"grant-test",fn:"testAuthority.inspect",scopes:["*"]})).rejects.toThrow();
 await grant("grant-test"); await expect(grant("grant-test","owner-b")).rejects.toThrow();
 await ctx.fns.cron.setEnabled({name:"grant-test",enabled:false});
});
test("parallel owner services isolate scope, identity and cleanup; legacy has no authority",async()=>{
 for(const [name,owner] of [["parallel-a","owner-a"],["parallel-b","owner-b"]]){await add(name);await grant(name,owner);}
 await add("legacy"); await drain();
 for(const [name,owner] of [["parallel-a","owner-a"],["parallel-b","owner-b"]]){const r=(await ctx.fns.cron.runs({name}))[0];expect(r.status).toBe("done");expect(r.result.authority.ownerId).toBe(owner);expect(r.result.wrong).toBeNull();expect(r.result.user).toBeNull();expect(r.result.agent).toBeNull();}
 expect((await ctx.fns.cron.runs({name:"legacy"}))[0].result.authority).toBeNull();
 expect(new Set(captured.map(x=>x.s)).size).toBe(captured.length);
 for(const {c,s} of captured){expect(Object.isFrozen(s)).toBe(true);expect(await c.fns.cron.authority({scope:"notification.enqueue"})).toBeNull();}
});
test("changed target invalidates grant, including claimed definition snapshot",async()=>{
 await add("stale");await grant("stale");await add("stale","testAuthority.fail");await add("stale");await drain();
 expect((await ctx.fns.cron.runs({name:"stale"}))[0].result.authority).toBeNull();
 await add("snapshot");await grant("snapshot");const run=await ctx.fns.cron.claim({});
 await ctx.fns.cron.add({name:"snapshot",fn:"testAuthority.inspect",every:"2h",args:{changed:true}});
 const session=Object.freeze({});ctx.state.cron.runCapabilities.set(session,Number(run.id));
 await withSession(session).fns.cron.runOne({id:Number(run.id)});
 expect((await ctx.fns.cron.runs({name:"snapshot"}))[0].result.authority).toBeNull();
});
test("wrong run token rejected, target throw cleans authority, null legacy stays compatible",async()=>{
 await add("throws","testAuthority.fail");await grant("throws","owner-a","testAuthority.fail");await drain();
 expect((await ctx.fns.cron.runs({name:"throws"}))[0].status).toBe("error");expect(await captured.at(-1).c.fns.cron.authority({scope:"notification.enqueue"})).toBeNull();
 const s=Object.freeze({});ctx.state.cron.runCapabilities.set(s,900);await expect(withSession(s).fns.cron.runOne({id:901})).rejects.toThrow();
 await add("direct-legacy");await grant("direct-legacy");const run=await ctx.fns.cron.claim({});await ctx.fns.cron.runOne({id:Number(run.id)});
 expect((await ctx.fns.cron.runs({name:"direct-legacy"}))[0].result.authority).toBeNull();
});
