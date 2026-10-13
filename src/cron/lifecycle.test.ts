import {beforeAll,afterAll,test,expect} from "bun:test";
import {mkTestCtx} from "../_testCtx.entry";
let base:any;
beforeAll(async()=>{base=await mkTestCtx();});
afterAll(async()=>{await base.fns.procs.db.close({});});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
function isolated(){
 const c=Object.create(base);c.session=null;c.state={...base.state,cron:{},registry:{...base.state.registry,cron:{...base.state.registry.cron},procs:{...base.state.registry.procs,log:{error:()=>{}},db:{select:async()=>[]}}}};
 return c;
}
test("legacy readiness and start/stop fail closed without mutating running",async()=>{
 const c=isolated();c.state.cron.running=true;
 expect(await c.fns.cron.workerReadiness({})).toMatchObject({ready:false,legacyRequiresDrain:true,reason:"legacy-worker-untracked"});
 await expect(c.fns.cron.workerStart({})).rejects.toThrow("legacy");
 await expect(c.fns.cron.workerStop({})).rejects.toThrow("legacy");
 expect(c.state.cron.running).toBe(true);
});
test("concurrent starts are single flight; stop waits and start during drain rejects",async()=>{
 const c=isolated(),entered=gate(),release=gate();let count=0;
 c.state.registry.cron.workerLoop=async()=>{count++;entered.resolve();await release.promise;};
 const started=await Promise.all([c.fns.cron.workerStart({}),c.fns.cron.workerStart({})]);await entered.promise;
 expect(count).toBe(1);expect(started.filter((v:any)=>v.started)).toHaveLength(1);
 let drained=false;const stops=Promise.all([c.fns.cron.workerStop({}),c.fns.cron.workerStop({})]).then(()=>{drained=true;});
 await Promise.resolve();expect(drained).toBe(false);
 await expect(c.fns.cron.workerStart({})).rejects.toThrow("draining");
 release.resolve();await stops;expect(c.state.cron.workerPromise).toBeUndefined();
 expect((await c.fns.cron.workerReadiness({})).ready).toBe(false);
});
test("stale generation finally cannot clear newer lifecycle state",async()=>{
 const c=isolated(),release=gate();c.state.registry.cron.workerLoop=async()=>release.promise;
 await c.fns.cron.workerStart({});const old=c.state.cron.workerPromise;
 const replacement=Promise.resolve();c.state.cron.workerGeneration++;c.state.cron.workerPromise=replacement;c.state.cron.running=true;
 release.resolve();await old;expect(c.state.cron.workerPromise).toBe(replacement);expect(c.state.cron.running).toBe(true);
});
test("real loop capability readiness and error path await owned inflight runs",async()=>{
 const c=isolated(),entered=gate(),release=gate();let claims=0;
 c.state.registry.cron.claim=async()=>{if(claims++===0)return {id:12};throw new Error("claim failed");};
 c.state.registry.cron.runOne=async(_c:any,s:any)=>{expect(c.state.cron.runCapabilities.get(s)).toBe(12);entered.resolve();await release.promise;};
 await c.fns.cron.workerStart({});const loop=c.state.cron.workerPromise;await entered.promise;
 expect((await c.fns.cron.workerReadiness({})).ready).toBe(true);
 let stopped=false;const stop=c.fns.cron.workerStop({}).catch((e:Error)=>{expect(e.message).toBe("claim failed");}).then(()=>{stopped=true;});
 await Promise.resolve();expect(stopped).toBe(false);release.resolve();await stop;await loop.catch(()=>{});
 expect(c.state.cron.activeWorkerToken).toBeUndefined();
});
test("sessions cannot invoke lifecycle controls",async()=>{
 const c=isolated();c.session={agentId:"fake"};
 for(const name of ["workerStart","workerStop","workerLoop"]) await expect(c.fns.cron[name]({})).rejects.toThrow("lifecycle-only");
 expect(c.state.cron.running).toBeUndefined();
});
