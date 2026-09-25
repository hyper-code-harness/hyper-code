import { expect, test } from 'bun:test';
import { testCtx } from '../$test';
import route from './$route_$id_automation_POST';
import migration from './$migration_20290925120000_function_rag_gate';
const ctx = await testCtx();
for(const master of [false,true])for(const gate of [false,true])for(const rerank of [false,true])test(`save/load independent toggles ${master}/${gate}/${rerank}`,async()=>{
    const agent=await ctx.fns.agent.start({model:'mock:test'});
    await ctx.fns.agent.setAutomation({id:agent.id,functionRagEnabled:master,functionRagGateEnabled:gate,jevRerankEnabled:rerank});
    await ctx.fns.session.save({agent});const loaded=await ctx.fns.session.load({id:agent.id});
    expect([loaded?.functionRagEnabled,loaded?.functionRagGateEnabled,loaded?.jevRerankEnabled]).toEqual([master,gate,rerank]);
});
test('unchecked form fields become false; checked gate stays independent',async()=>{
    const agent=await ctx.fns.agent.start({model:'mock:test'});
    await ctx.fns.agent.setAutomation({id:agent.id,functionRagEnabled:true,functionRagGateEnabled:true,jevRerankEnabled:true});
    const form=new FormData();form.set('functionRagGateEnabled','1');
    const response=await route(ctx,null,{params:{id:agent.id},req:new Request('http://local/automation',{method:'POST',body:form})});expect(response.status).toBe(204);
    const loaded=await ctx.fns.session.load({id:agent.id});expect([loaded?.functionRagEnabled,loaded?.functionRagGateEnabled,loaded?.jevRerankEnabled]).toEqual([false,true,false]);
});
test('omitted settings stay untouched and new gate defaults off',async()=>{
    const a=await ctx.fns.agent.start({model:'mock:test'});expect((await ctx.fns.session.load({id:a.id}))?.functionRagGateEnabled).toBe(false);
    await ctx.fns.agent.setAutomation({id:a.id,functionRagGateEnabled:true});await ctx.fns.agent.setAutomation({id:a.id,jevRerankEnabled:true});expect((await ctx.fns.session.load({id:a.id}))?.functionRagGateEnabled).toBe(true);
});
test('split migration preserves prior coupling on isolated temporary table',async()=>{
    // This ctx uses pg_temp; transaction rolls back the isolated table substitution.
    await ctx.fns.procs.db.exec({sql:'BEGIN; ALTER TABLE agents RENAME TO original_agents; CREATE TABLE agents (jev_rerank_enabled boolean NOT NULL); INSERT INTO agents VALUES (true),(false);'});
    try{await migration.up(ctx);const rows=await ctx.fns.procs.db.select({sql:'SELECT * FROM agents ORDER BY jev_rerank_enabled'});expect(rows.map(r=>r.function_rag_gate_enabled)).toEqual([false,true]);}finally{await ctx.fns.procs.db.exec({sql:'ROLLBACK'});}
});

test('empty function-RAG outcomes are persisted through session event APIs',async()=>{
    const a=await ctx.fns.agent.start({model:'mock:test'});
    await ctx.fns.session.appendEvent({id:a.id,event:{type:'user',text:'hello',messageIdx:0}});
    await ctx.fns.session.syncAgentState({agent:a});
    const result=await ctx.fns.agent.markFunctionRag({agent:a,messageIdx:0,functions:[],injected:'',gate:'error',needsTool:null,retrieved:0,rerankStatus:'skipped'});
    expect(result.updated).toBe(true);
    const events=await ctx.fns.session.getEvents({id:a.id});const event=events.find(e=>e.type==='user');
    expect(event.functionRag.gate).toBe('error');expect(event.functionRag.functions).toEqual([]);expect(event.html).toContain('retrieved 0 · kept 0');
    expect(a.events.find(e=>e.type==='user')?.functionRag.rerankStatus).toBe('skipped');
});
