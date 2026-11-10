import {test,expect} from 'bun:test';
import flowDiagram from './flowDiagram';
import sequenceDiagram from '../../../diagrams/src/diagrams/sequenceDiagram';
import scenarioDiagram from '../../../diagrams/src/diagrams/scenarioDiagram';
import scenarioValidate from '../../../diagrams/src/diagrams/scenarioValidate';
import measureText from './measureText';
const ctx={fns:{svg:{measureText:(o:Parameters<typeof measureText>[2])=>measureText(ctx,null,o)},diagrams:{sequenceDiagram:(o:Parameters<typeof sequenceDiagram>[2])=>sequenceDiagram(ctx,null,o),scenarioValidate:(o:Parameters<typeof scenarioValidate>[2])=>scenarioValidate(ctx,null,o)}}} as Context;
test('IBM-inspired flow sizes before layout and keeps orthogonal routes',async()=>{
 const nodes=[{id:'a',label:'Start'},{id:'b',label:'Ready?',shape:'diamond' as const},{id:'c',label:'Promote'}],edges=[{from:'a',to:'b'},{from:'b',to:'c'}];
 for(const columns of [3,5] as const){const r=await flowDiagram(ctx,null,{nodes,edges,theme:'ibm-inspired',direction:'down',columns,mainPath:['a','b','c'],compact:true});
 expect(r.svg).toContain('#0f62fe');for(const b of r.boxes){expect(b.width%8).toBe(0);expect(b.height%8).toBe(0);}for(const e of r.routes)for(let i=1;i<e.points.length;i++)expect(e.points[i]!.x===e.points[i-1]!.x||e.points[i]!.y===e.points[i-1]!.y).toBe(true);}
});
test('IBM-inspired scenario inherits participant sizing, actions and phases',async()=>{
 const model={actors:[{id:'a',label:'Client'},{id:'b',label:'Identity provider'}],steps:[{type:'phase' as const,id:'p',title:'Authentication',steps:[{type:'action' as const,id:'x',actor:'a',label:'Prepare PKCE'},{type:'message' as const,id:'m',from:'a',to:'b',kind:'request' as const,label:'Authorize'}]}]};
 const old=await scenarioDiagram(ctx,null,{model}),r=await scenarioDiagram(ctx,null,{model,theme:'ibm-inspired'});expect(r.actors[0]!.width).toBe(224);expect(r.actors[0]!.height%8).toBe(0);expect(r.actions[0]!.height%8).toBe(0);expect(r.actions[0]!.height).toBeGreaterThan(old.actions[0]!.height);expect(r.svg).toContain('IBM Plex Sans');expect(r.svg).toContain('#8a3ffc');expect(r.phases).toHaveLength(1);
 const s=await sequenceDiagram(ctx,null,{participants:model.actors,messages:[],theme:'ibm-inspired'});expect(s.boxes[0]!.width).toBe(r.actors[0]!.width);
});
