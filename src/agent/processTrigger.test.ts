import {expect,test} from 'bun:test';
import processTrigger from './processTrigger';

function fixture(result: unknown, ready=false, fail=false) {
    const runs: any[]=[]; const deliveries: any[]=[]; const writes:any[]=[];
    const ref={version:1,id:'11111111-1111-4111-8111-111111111111',ownerAgentId:'owner',bytes:20000,sha256:'a'.repeat(64),kind:'trigger:tr_test'};
    const row={id:'tr_test',agent_id:'owner',kind:'watch',config:{everyMs:5000},mode:'once',next_at:1};
    const ctx:any={fns:{procs:{db:{select:async()=>[row],run:async(o:any)=>{if(o.sql.startsWith('INSERT'))runs.push(o.params);return{changes:1};}}},
        resultStore:{write:async(o:any)=>{writes.push(o);if(fail)throw Error('disk full');return ref;}},
        agent:{watchPredicate:async()=>({result,ready}),deliverTriggerPrompt:async(o:any)=>{deliveries.push(o);return true;}}}};
    return {ctx,runs,deliveries,writes,ref,row};
}

test('false predicate stores large valid JSON preview/ref without notifying',async()=>{
    const value={rows:['界'.repeat(20000)]}; const f=fixture(value);
    expect(await processTrigger(f.ctx,null,{triggerId:'tr_test',claimToken:'claim',now:2})).toEqual({outcome:'waiting'});
    expect(f.deliveries).toHaveLength(0); expect(f.runs).toHaveLength(1);
    expect(JSON.parse(f.runs[0][3])).toMatchObject({truncated:true});
    expect(f.runs[0][3].length).toBeLessThan(3000);
    expect(JSON.parse(f.runs[0][4])).toEqual(f.ref);
    expect(JSON.parse(f.writes[0].text)).toEqual(value);
});

test('storage failure preserves run and readiness without a dangling ref',async()=>{
    const f=fixture('x'.repeat(20000),true,true); (f.row as any).prompt='ready';
    expect(await processTrigger(f.ctx,null,{triggerId:'tr_test',claimToken:'claim',now:2})).toEqual({outcome:'fired'});
    expect(f.runs).toHaveLength(1); expect(f.runs[0][4]).toBeNull();
    expect(JSON.parse(f.runs[0][3]).storageError).toContain('unavailable');
    expect(f.deliveries).toHaveLength(1); expect(f.deliveries[0].resultRef).toBeUndefined();
});

test('small results remain identical and stored refs attach to fired prompt',async()=>{
    for (const value of [null,false,0,'small',{ready:false}]) {
        const f=fixture(value); await processTrigger(f.ctx,null,{triggerId:'tr_test',claimToken:'claim',now:2});
        expect(JSON.parse(f.runs[0][3])).toEqual(value);expect(f.runs[0][4]).toBeNull();expect(f.writes).toHaveLength(0);
    }
    const f=fixture('x'.repeat(20000),true);(f.row as any).prompt='ready';
    await processTrigger(f.ctx,null,{triggerId:'tr_test',claimToken:'claim',now:2});
    expect(f.deliveries[0].resultRef).toEqual(f.ref);
});

test('serialization failure keeps valid audit JSON',async()=>{
    const circular:any={};circular.self=circular;const f=fixture(circular);
    await processTrigger(f.ctx,null,{triggerId:'tr_test',claimToken:'claim',now:2});
    expect(JSON.parse(f.runs[0][3]).storageError).toContain('unavailable');
});
