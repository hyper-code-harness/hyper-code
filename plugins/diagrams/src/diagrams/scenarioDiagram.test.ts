import { describe, expect, test } from 'bun:test';
import scenarioValidate from './scenarioValidate';
import scenarioDiagram from './scenarioDiagram';
import sequenceDiagram from './sequenceDiagram';
import type { Scenario } from './Scenario';
const ctx = {fns:{diagrams:{scenarioValidate:(o:{model:Scenario})=>scenarioValidate(ctx,null,o),sequenceDiagram:(o:Parameters<typeof sequenceDiagram>[2])=>sequenceDiagram(ctx,null,o)}}} as Context;
const validate=(model:unknown)=>scenarioValidate(ctx,null,{model:model as Scenario});
const render=(model:Scenario)=>scenarioDiagram(ctx,null,{model});
const actors=[{id:'client',label:'Client'},{id:'server',label:'Server'}];
const request={type:'message',id:'req',from:'client',to:'server',label:'Request',kind:'request'} as const;
const model:Scenario={id:'demo',title:'Simplified interaction',actors,steps:[{type:'phase',id:'auth',title:'Authorization',steps:[{type:'action',id:'prepare',actor:'client',label:'Prepare request'},request,{type:'phase',id:'nested',title:'Nested',steps:[{type:'message',id:'reply',from:'server',to:'client',label:'Response',kind:'reply'}]}]},{type:'phase',id:'empty',title:'Empty phase',steps:[]}]};
describe('typed scenarios',()=>{
 test('validates without mutation, renders real phases/actions and stable IDs',async()=>{
  const original=JSON.stringify(model);expect(await validate(model)).toEqual({valid:true,actors:2,steps:6,phases:3,messages:2,actions:1});
  const r=await render(model);expect(r.phases).toHaveLength(3);expect(r.actions).toHaveLength(1);expect(r.messages).toHaveLength(2);expect(r.svg).toContain('data-action-id="prepare"');expect(r.svg).toContain('stroke-dasharray="5 4"');expect(r.messages[0]!.points[0]!.y).toBeGreaterThan(r.actions[0]!.y+r.actions[0]!.height);
  const outer=r.phases[0]!,inner=r.phases[1]!;expect(inner.y).toBeGreaterThan(outer.y);expect(inner.y+inner.height).toBeLessThan(outer.y+outer.height);expect(JSON.stringify(model)).toBe(original);
  const again=await render({...model,actors:[...actors].reverse()});expect(again.actors.find(a=>a.id==='client')!.elementId).toBe(r.actors[0]!.elementId);
  for(const box of [...r.actors,...r.actions,...r.phases]){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(r.width);expect(box.y+box.height).toBeLessThanOrEqual(r.height);}
 });
 test('empty actors, steps, phases and labels; all kinds and self routes',async()=>{
  expect((await render({actors:[],steps:[]})).messages).toEqual([]);
  expect((await render({actors:[],steps:[{type:'phase',id:'p',title:'',steps:[]}]})).phases).toHaveLength(1);
  const r=await render({actors:[{id:'a',label:''}],steps:(['request','reply','send','redirect'] as const).map((kind,i)=>({type:'message',id:String(i),from:'a',to:'a',label:'',kind}))});
  expect(r.messages.map(m=>m.kind)).toEqual(['request','reply','send','redirect']);for(const m of r.messages) {expect(m.points).toHaveLength(4);for(const p of m.points)expect(p.x).toBeLessThan(r.width);}
 });
 test('escapes text and collision-resistant IDs',async()=>{
  const r=await render({title:'<script>&😀',actors:[{id:'a-b',label:'<img>&'},{id:'a_2db',label:'"label"'}],steps:[{type:'action',id:'<"&',actor:'a-b',label:'<script>alert(1)</script>'},{type:'message',id:'msg',from:'a-b',to:'a_2db',kind:'send',label:'<>&'}]});
  expect(r.svg).not.toContain('<script>');expect(r.svg).toContain('&lt;script&gt;');expect(r.svg).toContain('😀');expect(new Set(r.actors.map(a=>a.elementId)).size).toBe(2);expect(r.svg).not.toMatch(/NaN|Infinity/);
 });
 test('word wrapping preserves normal words and hard-splits only oversized tokens',async()=>{
  const label='Пользователь даёт согласие сохранить verifier браузер';
  const r=await render({actors,steps:[{type:'action',id:'a',actor:'client',label},{...request,label}]});
  for(const lines of [r.actions[0]!.lines,r.messages[0]!.label.lines]){for(const word of label.split(' '))expect(lines.some(line=>line.includes(word))).toBe(true);expect(lines.every(line=>Array.from(line).length<=33)).toBe(true);}
  expect(r.actions[0]!.lines.join('')).toBe(label);
  const long=await render({actors,steps:[{type:'action',id:'a',actor:'client',label:'x'.repeat(100)}]});expect(long.actions[0]!.lines.join('')).toBe('x'.repeat(100));expect(long.actions[0]!.lines).toHaveLength(5);
 });
 test('rejects invalid fields, global collisions, actor references and XML',async()=>{
  const invalid:unknown[]=[null,{}, {actors,steps:[{...request,kind:['request']}]},{actors,steps:[{type:['phase'],id:'p',title:'',steps:[]}]},{actors,steps:[{type:'check',id:'c'}]},{actors,steps:[{type:'stop',id:'s'}]},{actors,steps:[{...request,to:'missing'}]},{actors,steps:[{type:'action',id:'a',actor:'missing',label:''}]},{actors,steps:[{...request,id:'client'}]},{id:'client',actors,steps:[]},{actors,steps:[request,request]},{actors,steps:[],extra:1},{actors,steps:[{...request,optional:true}]},{actors:[{id:' ',label:''}],steps:[]},{actors:[{id:'a',label:'\u0000'}],steps:[]},{actors,steps:[{...request,label:'x'.repeat(301)}]},{actors,steps:[{...request,id:'x'.repeat(129)}]},{actors,steps:[{...request,label:'\ud800'}]}];
  for(const m of invalid)await expect(validate(m)).rejects.toThrow();
 });
 test('limits, depth and object/array cycles',async()=>{
  const nested=(n:number):Scenario['steps']=>n?[{type:'phase',id:'p'+n,title:'',steps:nested(n-1)}]:[];
  await validate({actors:[],steps:nested(8)});await expect(validate({actors:[],steps:nested(9)})).rejects.toThrow('eight');
  await expect(validate({actors:Array.from({length:31},(_,i)=>({id:String(i),label:''})),steps:[]})).rejects.toThrow('30');
  await expect(validate({actors,steps:Array.from({length:201},(_,i)=>({...request,id:String(i)}))})).rejects.toThrow('200');
  const cyclic:Scenario['steps']=[];cyclic.push({type:'phase',id:'cycle',title:'',steps:cyclic});await expect(validate({actors:[],steps:cyclic})).rejects.toThrow('Cyclic');
  const p:Extract<Scenario['steps'][number],{type:'phase'}>={type:'phase',id:'p',title:'',steps:[]};p.steps.push(p);await expect(validate({actors:[],steps:[p]})).rejects.toThrow('Cyclic');
 });
});
