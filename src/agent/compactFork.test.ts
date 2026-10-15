import { test, expect } from 'bun:test';
import compact from './compact';

test('fork compaction replaces only own rows and retains structured refs', async () => {
 const inherited = {role:'tool',content:'parent',tool_call_id:'parent'};
 const ref = {version:1,id:'uuid',ownerAgentId:'child'};
 const own = [{role:'assistant',content:'',tool_calls:[]},{role:'tool',content:'child',tool_call_id:'child',result_ref:ref}];
 const agent:any = {id:'child',parentId:'parent',messages:[inherited,...own]};
 let written:any[]=[];
 const ctx:any = {fns:{session:{syncAgentState:async()=>agent,getMessages:async()=>own,replaceMessages:async({messages}:any)=>{written=messages;}}}};
 expect((await compact(ctx,null,{agent,summary:'short'})).replaced).toBe(true);
 expect(written).toHaveLength(2);
 expect(written[1].result_ref).toEqual(ref);
 expect(written[1].content).toBe('[compacted] short');
 expect(inherited.content).toBe('parent');
 written=[];
 expect((await compact(ctx,null,{agent,message:0,summary:'no'})).replaced).toBe(false);
 expect(written).toHaveLength(0);
});
