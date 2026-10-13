import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

async function fixture() {
 const ctx:any=await mkTestCtx();
 await ctx.fns.procs.db.run({sql:"INSERT INTO agents(id,model,system_prompt,scratchpad,created_at,updated_at,created_by) VALUES('notify','mock:echo','','{}',0,0,'owner'),('sender','mock:echo','','{}',0,0,'owner'),('foreign','mock:echo','','{}',0,0,'other')"});
 ctx.session={user:{id:'owner'}};
 ctx.state.registry.agent.wakeWorker=()=>{};
 ctx.state.registry.agent.wakeWaiters=async()=>{};
 ctx.state.registry.agent.renderEventHtml=async()=>'<p>notification</p>';
 return ctx;
}
const input={to:'notify',key:'source:event:1',text:'hello',originalAuthor:'owner'};
async function counts(ctx:any) {
 return (await ctx.fns.procs.db.select({sql:"SELECT (SELECT count(*)::int FROM messages WHERE agent_id='notify') messages,(SELECT count(*)::int FROM events WHERE agent_id='notify') events,(SELECT count(*)::int FROM session_notification_receipts WHERE agent_id='notify') receipts,(SELECT next_run_at FROM agents WHERE id='notify') wake"}))[0];
}
describe('session.enqueueNotification',()=>{
 test('atomic message/event/schedule, durable replay and payload mismatch',async()=>{
  const ctx=await fixture();
  const first=await ctx.fns.session.enqueueNotification(input);
  expect(first).toEqual({agentId:'notify',messageIdx:0,eventIdx:0,duplicate:false});
  expect(await counts(ctx)).toMatchObject({messages:1,events:1,receipts:1});
  expect((await counts(ctx)).wake).not.toBeNull();
  expect((await ctx.fns.session.enqueueNotification(input)).duplicate).toBe(true);
  await expect(ctx.fns.session.enqueueNotification({...input,text:'changed'})).rejects.toThrow('payload mismatch');
  await ctx.fns.session.truncateMessagesFrom({id:'notify',from:0});
  await ctx.fns.procs.db.run({sql:"DELETE FROM events WHERE agent_id='notify'"});
  await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=NULL WHERE id='notify'"});
  expect((await ctx.fns.session.enqueueNotification(input)).duplicate).toBe(true);
  expect(await counts(ctx)).toEqual({messages:0,events:0,receipts:1,wake:null});
 });
 test('rollback on event insert and scheduling failure leaves no partial delivery',async()=>{
  for(const fail of ['INSERT INTO events','UPDATE agents SET next_run_at']) {
   const ctx=await fixture(), original=ctx.state.registry.procs.db.run;
   ctx.state.registry.procs.db.run=async(c:any,s:any,o:any)=>{if(o.sql.startsWith(fail))throw new Error('injected failure');return original(c,s,o);};
   await expect(ctx.fns.session.enqueueNotification(input)).rejects.toThrow('injected failure');
   expect(await counts(ctx)).toEqual({messages:0,events:0,receipts:0,wake:null});
  }
 });
 test('concurrent duplicate keys return one delivery',async()=>{
  const ctx=await fixture();
  const results=await Promise.all(Array.from({length:8},()=>ctx.fns.session.enqueueNotification(input)));
  expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
  expect(await counts(ctx)).toMatchObject({messages:1,events:1,receipts:1});
 });
 test('concurrent unique keys serialize receipt allocation',async()=>{
  const ctx=await fixture();
  await Promise.all(Array.from({length:5},(_,i)=>ctx.fns.session.enqueueNotification({...input,key:'k'+i})));
  expect(await counts(ctx)).toMatchObject({messages:5,events:5,receipts:5});
 });
 test('invalid target, author, forged opts and anonymous transport fail closed',async()=>{
  const ctx=await fixture();
  for(const patch of [{to:'missing'},{to:'foreign'},{originalAuthor:'other'},{originalAuthor:'agent:foreign'}]) await expect(ctx.fns.session.enqueueNotification({...input,...patch})).rejects.toThrow();
  ctx.session=null;
  await expect(ctx.fns.session.enqueueNotification({...input,agent:{id:'sender'},system:true})).rejects.toThrow('authenticated');
  ctx.session={service:{ownerId:'owner',scopes:['notification.enqueue']}};
  await expect(ctx.fns.session.enqueueNotification(input)).rejects.toThrow('authenticated');
  ctx.session={agentId:'sender'};
  await expect(ctx.fns.session.enqueueNotification(input)).rejects.toThrow('impersonate');
  await expect(ctx.fns.session.enqueueNotification({...input,originalAuthor:'agent:notify'})).rejects.toThrow('impersonate');
  ctx.session={agentId:'foreign'};
  await expect(ctx.fns.session.enqueueNotification(input)).rejects.toThrow('owner mismatch');
  expect(await counts(ctx)).toEqual({messages:0,events:0,receipts:0,wake:null});
 });
 test('trusted service attribution differs from authority; same-owner grant required',async()=>{
  const ctx=await fixture();ctx.session={kind:'service'};
  ctx.state.cron={notificationServices:new WeakMap([[ctx.session,{ownerId:'owner',scopes:['notification.enqueue'],transportActor:'cron:7'}]])};
  await ctx.fns.session.enqueueNotification({...input,originalAuthor:'agent:sender'});
  const rows=await ctx.fns.procs.db.select({sql:"SELECT r.transport_actor,m.author FROM session_notification_receipts r JOIN messages m ON m.agent_id=r.agent_id AND m.idx=r.message_idx"});
  expect(rows[0]).toEqual({transport_actor:'cron:7',author:'agent:sender'});
  await expect(ctx.fns.session.enqueueNotification({...input,to:'foreign'})).rejects.toThrow('owner mismatch');
 });
 test('running recipient retains durable wake, earlier schedule stays earlier',async()=>{
  const ctx=await fixture();
  await ctx.fns.procs.db.run({sql:"UPDATE agents SET run_state='running',next_run_at=1 WHERE id='notify'"});
  await ctx.fns.session.enqueueNotification(input);
  expect(Number((await counts(ctx)).wake)).toBe(1);
  const rows=await ctx.fns.procs.db.select({sql:"SELECT run_state FROM agents WHERE id='notify'"});
  expect(rows[0].run_state).toBe('running');
 });
 test('post-commit projection failure does not undo receipt and target delete cascades',async()=>{
  const ctx=await fixture();ctx.state.registry.agent.wakeWaiters=async()=>{throw new Error('UI unavailable');};
  expect((await ctx.fns.session.enqueueNotification(input)).duplicate).toBe(false);
  expect(await counts(ctx)).toMatchObject({messages:1,events:1,receipts:1});
  await ctx.fns.procs.db.run({sql:"DELETE FROM agents WHERE id='notify'"});
  expect((await ctx.fns.procs.db.select({sql:'SELECT * FROM session_notification_receipts'}))).toHaveLength(0);
 });
});

test('notification receipt survives a full transcript clear and index reuse',async()=>{
 const ctx=await fixture();await ctx.fns.session.enqueueNotification(input);
 await ctx.fns.session.replaceMessages({id:'notify',messages:[]});
 await ctx.fns.session.replaceEvents({id:'notify',events:[]});
 await ctx.fns.session.appendMessage({id:'notify',message:{role:'user',content:'new unrelated message'}});
 await ctx.fns.procs.db.run({sql:"UPDATE agents SET next_run_at=NULL WHERE id='notify'"});
 expect((await ctx.fns.session.enqueueNotification(input)).duplicate).toBe(true);
 expect(await counts(ctx)).toEqual({messages:1,events:0,receipts:1,wake:null});
});

test('retry restarts entire transaction after actual Postgres unique violation',async()=>{
 const ctx=await fixture();
 await ctx.fns.session.appendMessage({id:'notify',message:{role:'user',content:'existing'}});
 const original=ctx.state.registry.procs.db.run;let failed=false;
 ctx.state.registry.procs.db.run=async(c:any,s:any,o:any)=>{
  if(!failed&&o.sql.startsWith('INSERT INTO messages')) {
   failed=true;
   return original(c,s,{sql:"INSERT INTO messages(agent_id,idx,role,content,ts) VALUES('notify',0,'user','collision',0)"});
  }
  return original(c,s,o);
 };
 expect((await ctx.fns.session.enqueueNotification(input)).messageIdx).toBe(1);
 expect(failed).toBe(true);
 expect(await counts(ctx)).toMatchObject({messages:2,events:1,receipts:1});
});

