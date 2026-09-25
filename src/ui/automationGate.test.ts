import {test,expect} from 'bun:test';
import render from './agentMetaSection';
test('Automation renders independent gate and rerank checkboxes',()=>{
 const toggles:any[]=[];const ctx:any={fns:{ui:{toggle:(o:any)=>{toggles.push(o);return `<input name="${o.name}">`;}},procs:{ui:{escape:({text}:any)=>String(text)}}}};
 const html=render(ctx,null,{section:'automation',agent:{id:'test',functionRagEnabled:true,functionRagGateEnabled:true,jevRerankEnabled:false} as any});
 expect(html).toContain('functionRagGateEnabled');expect(toggles.map(x=>[x.name,x.enabled])).toEqual([['functionRagEnabled',true],['functionRagGateEnabled',true],['jevRerankEnabled',false]]);
});
