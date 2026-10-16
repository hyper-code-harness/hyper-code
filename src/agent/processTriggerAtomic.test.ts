import {expect,test} from 'bun:test';
import {mkTestCtx} from '../_testCtx.entry';

test('trigger finalization rolls back if audit insert fails, then commits both on retry',async()=>{
    const ctx=await mkTestCtx();
    const agent=await ctx.fns.agent.start({model:'mock:test'});
    ctx.state.registry.agent.watchPredicate=async()=>({ready:false,result:{ok:true}});
    const trigger=await ctx.fns.agent.watch({id:agent.id,predicate:'runtime.fn',opts:{name:'tmp.probe'},prompt:'ready',everyMs:5000});
    await ctx.fns.procs.db.run({sql:"UPDATE agent_triggers SET status='checking',claim_token='claim',claimed_at=1 WHERE id=?",params:[trigger.id]});
    const before=await ctx.fns.procs.db.select({sql:'SELECT status,attempts,claim_token FROM agent_triggers WHERE id=?',params:[trigger.id]});
    await ctx.fns.procs.db.exec({sql:"ALTER TABLE agent_trigger_runs ADD CONSTRAINT forced_audit_failure CHECK (outcome <> 'waiting')"});
    await expect(ctx.fns.agent.processTrigger({triggerId:trigger.id,claimToken:'claim',now:2})).rejects.toThrow();
    expect(await ctx.fns.procs.db.select({sql:'SELECT status,attempts,claim_token FROM agent_triggers WHERE id=?',params:[trigger.id]})).toEqual(before);
    expect(await ctx.fns.procs.db.select({sql:'SELECT * FROM agent_trigger_runs WHERE trigger_id=?',params:[trigger.id]})).toHaveLength(0);
    await ctx.fns.procs.db.exec({sql:'ALTER TABLE agent_trigger_runs DROP CONSTRAINT forced_audit_failure'});
    expect(await ctx.fns.agent.processTrigger({triggerId:trigger.id,claimToken:'claim',now:2})).toEqual({outcome:'waiting'});
    const after=await ctx.fns.procs.db.select({sql:'SELECT status,attempts,claim_token FROM agent_triggers WHERE id=?',params:[trigger.id]});
    expect(after[0]).toMatchObject({status:'active',attempts:Number(before[0].attempts)+1,claim_token:null});
    expect(await ctx.fns.procs.db.select({sql:'SELECT * FROM agent_trigger_runs WHERE trigger_id=?',params:[trigger.id]})).toHaveLength(1);
});
