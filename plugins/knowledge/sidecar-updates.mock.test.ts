import { test, expect } from 'bun:test';
// Load standalone procedures without the runtime: no server, database or global mocks.
const load = async (path: string) => {
 const js = new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file(new URL(path, import.meta.url)).text()).replace('export default async function', 'return async function');
 return new Function(js)();
};
const schemaOf = (defs: any[]) => async () => ({ types: ['Person','Organization','Product','Concept','Standard'].map(type => ({ type, description: type, anonymous: false, required: [], hint: undefined })), attributes: defs.map(d => ({ name: d.id.slice(10), datatype: d.data.datatype ?? 'string', domain: [].concat(d.data.domain ?? []).map((x: string) => x.slice(7)), range: [].concat(d.data.range ?? []).map((x: string) => x.slice(7)), cardinality: d.data.cardinality === 'multi' ? 'multi' : 'single', vocabulary: d.data.vocabulary, description: '' })), vocabularies: {} });
const writer = await load('./src/knowledge/setObservedMentions.ts');
const updater = await load('./src/knowledge/updateSidecar.ts');
function fixture(contents: string[] = ['Acme headline Old']) {
 const state = {entities: new Map<string, any>([['Organization/acme',{type:'Organization',data:{title:'Acme',headline:'Old'}}],['Organization/other',{type:'Organization',data:{title:'Other'}}],['Product/widget',{type:'Product',data:{title:'Widget',vendor:'Organization/acme'}}]]), provenance: [] as any[], edges: [] as any[], scratchpad: {knowledgeSidecar:{status:'error',error:'stale',appliedSourceMessageIdx:-1}} as any};
 const defs = [{id:'Attribute/headline',data:{domain:'Entity/Organization',datatype:'string'}},{id:'Attribute/vendor',data:{domain:'Entity/Product',range:'Entity/Organization',datatype:'ref'}}];
 const messages = contents.map((content,idx)=>({idx,content,role:'user'}));
 const tx = {unsafe: async (sql:string,p:any[]=[]) => {
  if(sql.includes('SELECT scratchpad')) return [{scratchpad:structuredClone(state.scratchpad)}];
  if(sql.includes("type='Attribute'")) return defs;
  if(sql.startsWith('SELECT value FROM knowledge.provenance')) return state.provenance.filter(x=>x.subject===p[0]&&x.attribute===p[1]&&x.url.startsWith('hyper://agent/parent/message/'));
  if(sql.startsWith('SELECT type,data')||sql.startsWith('SELECT data FROM')) {const row=state.entities.get(p[0]);return row?[structuredClone(row)]:[];}
  if(sql.startsWith('SELECT id FROM')) return state.entities.has(p[0])?[{id:p[0]}]:[];
  if(sql.startsWith('INSERT INTO knowledge.entities')) state.entities.set(p[0],{type:p[1],data:JSON.parse(p[2])});
  else if(sql.startsWith('INSERT INTO knowledge.provenance')) state.provenance.push({subject:p[0],attribute:p[1],value:JSON.parse(p[2]),url:p[3],evidence:p[4]});
  else if(sql.startsWith('UPDATE knowledge.entities')) state.entities.get(p[0]).data=JSON.parse(p[1]);
  else if(sql.startsWith('DELETE FROM knowledge.relations')) state.edges=state.edges.filter(x=>x[0]!==p[0]||x[1]!==p[1]);
  else if(sql.startsWith('INSERT INTO knowledge.relations')) state.edges.push(p);
  else if(sql.startsWith('UPDATE agents')) state.scratchpad=JSON.parse(p[1]);
  else if(!/SELECT pg_advisory|LOCK TABLE|INSERT INTO knowledge.search|INSERT INTO knowledge.entity_changes/.test(sql)) throw Error('Unexpected SQL '+sql);
  return [];
 }};
 const parent:any={id:'parent',scratchpad:structuredClone(state.scratchpad)};
 const child={id:'child',parentId:'parent',scratchpad:{knowledgeSidecarFor:'parent',sourceMessageIdx:contents.length-1}};
 const ctx:any={state:{agent:{parent}},fns:{procs:{db:{select:async()=>[{parent_id:null,fork_offset:null}],conn:async()=>({begin:async(fn:any)=>{const backup=structuredClone(state);try{return await fn(tx);}catch(e){Object.assign(state,backup);throw e;}}})}},session:{getMessages:async()=>messages},knowledge:{extractionSchema:schemaOf(defs),resolveMentions:async({mentions}:any)=>mentions.map((mention:any)=>({mention,resolution:{status:'new',id:null,candidates:[]}}))},events:{refreshAgentMeta:()=>{}}}};
 const mention=(extra:any={})=>({id:'m1',type:'Organization',name:'Acme',entityId:'Organization/acme',evidence:contents.at(-1),confidence:1,sourceMessageIdx:contents.length-1,...extra});
 return {state,ctx,parent,child,mention,run:(mentions:any[])=>writer(ctx,{agent:child},{mentions})};
}
test('existing verified ID reused even when resolver proposes new',async()=>{const f=fixture();const r=await f.run([f.mention()]);expect(r.created).toEqual([]);expect(f.state.entities.size).toBe(3);expect(r.mentions[0].entityId).toBe('Organization/acme');});
test('fake or mismatched canonical ID rejected',async()=>{for(const entityId of ['Organization/missing','Product/widget']){const f=fixture();await expect(f.run([f.mention({entityId})])).rejects.toThrow('Unverified canonical');}});
test('new entities are created',async()=>{const f=fixture(['Novel exists']);const r=await f.run([f.mention({name:'Novel',entityId:undefined})]);expect(r.created.length).toBe(1);});
test('add fills empty field and stores fact provenance backlink',async()=>{const f=fixture(['Acme headline New']);delete f.state.entities.get('Organization/acme').data.headline;await f.run([f.mention({attributeUpdates:[{attribute:'headline',value:'New',evidence:'Acme headline New',operation:'add'}]})]);expect(f.state.entities.get('Organization/acme').data.headline).toBe('New');expect(f.state.provenance.at(-1).url).toBe('hyper://agent/parent/message/0');});
test('ordinary and add conflicts never replace',async()=>{for(const useUpdate of [true,false]){const f=fixture(['Acme headline New']);await f.run([f.mention(useUpdate?{attributeUpdates:[{attribute:'headline',value:'New',evidence:'Acme headline New',operation:'add'}]}:{attributes:{headline:'New'},attributeEvidence:{headline:'Acme headline New'}})]);expect(f.state.entities.get('Organization/acme').data.headline).toBe('Old');expect(f.state.provenance.at(-1).value).toBe('New');}});
test('explicit correction replaces current chat-owned value and retains old provenance',async()=>{const f=fixture(['Acme headline Old','Исправь: у Acme описание New.']);f.state.provenance.push({subject:'Organization/acme',attribute:'headline',value:'Old',url:'hyper://agent/parent/message/0'});await f.run([f.mention({attributeUpdates:[{attribute:'headline',value:'New',evidence:'Исправь: у Acme описание New.',operation:'correct'}]})]);expect(f.state.entities.get('Organization/acme').data.headline).toBe('New');expect(f.state.provenance.filter(x=>x.attribute==='headline').map(x=>x.value)).toEqual(['Old','New']);});
test('unmarked or unowned correction rejected atomically',async()=>{for(const quote of ['Acme headline New','Исправь: у Acme описание New.']){const f=fixture([quote]);await expect(f.run([f.mention({attributeUpdates:[{attribute:'headline',value:'New',evidence:quote,operation:'correct'}]})])).rejects.toThrow();expect(f.state.entities.get('Organization/acme').data.headline).toBe('Old');expect(f.state.provenance).toEqual([]);}});
test('reference correction replaces outgoing graph and preserves provenance',async()=>{const quote='Actually, Widget is developed by Other, not Acme.';const f=fixture(['Widget vendor Acme',quote]);f.state.provenance.push({subject:'Product/widget',attribute:'vendor',value:'Organization/acme',url:'hyper://agent/parent/message/0'});f.state.edges.push(['Product/widget','vendor','Organization/acme']);await f.run([f.mention({type:'Product',name:'Widget',entityId:'Product/widget',attributeUpdates:[{attribute:'vendor',value:'Organization/other',evidence:quote,operation:'correct'}]})]);expect(f.state.entities.get('Product/widget').data.vendor).toBe('Organization/other');expect(f.state.edges).toEqual([['Product/widget','vendor','Organization/other']]);expect(f.state.provenance.filter(x=>x.attribute==='vendor').length).toBe(2);});
test('duplicate quote accepted with verified source index for mention and fact',async()=>{const f=fixture(['Acme headline Old','Acme headline Old']);await f.run([f.mention({sourceAgentId:'parent',attributes:{headline:'Old'},attributeEvidence:{headline:'Acme headline Old'}})]);expect(f.state.provenance.every(x=>x.url.endsWith('/1'))).toBe(true);});
test('fake source, missing quote at index and ambiguous fallback rejected',async()=>{for(const extra of [{sourceAgentId:'fake'},{sourceMessageIdx:90},{sourceMessageIdx:undefined}]){const f=fixture(['Acme headline Old','Acme headline Old']);await expect(f.run([f.mention(extra)])).rejects.toThrow();}});
test('empty successful report clears stale error and synchronizes both checkpoints',async()=>{const f=fixture(['nothing relevant']);await f.run([]);expect(f.state.scratchpad.knowledgeSidecar).toMatchObject({status:'ready',lastSuccessfulMessageIdx:0,appliedSourceMessageIdx:0});expect(f.state.scratchpad.knowledgeSidecar.error).toBeUndefined();});
test('updateSidecar fetches live same-chat context and new source window; keeps fork REPL flow',async()=>{const f=fixture(['old','Acme headline New']);f.parent.scratchpad.knowledgeSidecar={appliedSourceMessageIdx:0,mentions:[{entityId:'Organization/acme'}]};let prompt='';f.ctx.fns.procs.db.select=async({sql,params}:any)=>sql.includes('jsonb_array_elements_text')?[{id:'Organization/acme',type:'Organization',data:{title:'Acme',headline:'Live'},relations:[]}]:[];f.ctx.fns.session.fork=async()=>({id:'fork',scratchpad:{}});f.ctx.fns.session.save=async()=>{};f.ctx.fns.settings={getNumber:async()=>1000};f.ctx.fns.agent={run:async({userText}:any)=>{prompt=userText;f.parent.scratchpad.knowledgeSidecar={status:'ready',appliedSourceMessageIdx:1,sidecarId:'fork',mentions:[]};},archiveMember:async()=>{},stop:async()=>{}};f.ctx.fns.session.archive=async()=>{};f.ctx.fns.session.setVisibility=async()=>{};f.ctx.fns.events.refreshAgentMeta=()=>{};const result=await updater(f.ctx,null,{agent:f.parent,messageIdx:1});expect(result.status).toBe('ready');expect(prompt).toContain('"headline":"Live"');expect(prompt).toContain('"idx":1');expect(prompt).not.toContain('"idx":0');});

test('empty source window still reports through fork and advances checkpoint',async()=>{const f=fixture([]);f.parent.scratchpad.knowledgeSidecar={appliedSourceMessageIdx:0};let prompt='';f.ctx.fns.procs.db.select=async()=>[];f.ctx.fns.session.fork=async()=>({id:'fork',scratchpad:{}});f.ctx.fns.session.save=async()=>{};f.ctx.fns.session.archive=async()=>{};f.ctx.fns.settings={getNumber:async()=>1000};f.ctx.fns.agent={run:async({userText}:any)=>{prompt=userText;f.parent.scratchpad.knowledgeSidecar={status:'ready',appliedSourceMessageIdx:1,sidecarId:'fork',mentions:[]};}};expect((await updater(f.ctx,null,{agent:f.parent,messageIdx:1})).status).toBe('ready');expect(prompt).toContain('exclusive start 0):\n[]');});


test('last-turn fact counters reflect adds, corrections, no-ops and conflicts, not observations',async()=>{
 for(const mode of ['add','correct','noop','conflict']) {
  const quote=mode==='correct'?'Actually Acme headline New':'Acme headline New';
  const f=fixture([quote]); const data=f.state.entities.get('Organization/acme').data;
  if(mode==='add') delete data.headline;
  if(mode==='noop') data.headline='New';
  if(mode==='correct') f.state.provenance.push({subject:'Organization/acme',attribute:'headline',value:'Old',url:'hyper://agent/parent/message/0'});
  await f.run([f.mention({attributeUpdates:[{attribute:'headline',value:'New',evidence:quote,operation:mode==='correct'?'correct':'add'}]})]);
  const turn=f.state.scratchpad.knowledgeSidecar.lastTurn;
  expect(turn).toMatchObject({sourceMessageIdx:0,matched:1,created:0,skippedMentions:0});
  expect(turn.facts).toEqual({added:mode==='add'?1:0,changed:mode==='correct'?1:0,noop:mode==='noop'?1:0,conflict:mode==='conflict'?1:0,skipped:0});
 }
});
test('last-turn distinct entities, ambiguity skips, empty batch, duplicate checkpoint and rollback',async()=>{
 const f=fixture(); await f.run([f.mention(),f.mention({id:'m2'})]);
 expect(f.state.scratchpad.knowledgeSidecar.lastTurn.matched).toBe(1);
 const saved=structuredClone(f.state.scratchpad.knowledgeSidecar.lastTurn); await f.run([]);
 expect(f.state.scratchpad.knowledgeSidecar.lastTurn).toEqual(saved);
 const fresh=fixture(); await fresh.run([]); expect(fresh.state.scratchpad.knowledgeSidecar.lastTurn).toMatchObject({matched:0,created:0});
 const novel=fixture(['Novel exists']); await novel.run([novel.mention({name:'Novel',entityId:undefined})]); expect(novel.state.scratchpad.knowledgeSidecar.lastTurn.created).toBe(1);
 const ambiguous=fixture(); ambiguous.ctx.fns.knowledge.resolveMentions=async({mentions}:any)=>mentions.map((mention:any)=>({mention,resolution:{status:'ambiguous',candidates:[]}}));
 await ambiguous.run([ambiguous.mention({entityId:undefined,attributes:{headline:'Old'},attributeEvidence:{headline:'Acme headline Old'}})]);
 expect(ambiguous.state.scratchpad.knowledgeSidecar.lastTurn).toMatchObject({matched:0,created:0,skippedMentions:1,facts:{skipped:1}});
 const broken=fixture(['Acme headline New']); broken.state.scratchpad.knowledgeSidecar.lastTurn=saved;
 await expect(broken.run([broken.mention({attributeUpdates:[{attribute:'headline',value:'New',operation:'correct',evidence:'Acme headline New'}]})])).rejects.toThrow();
 expect(broken.state.scratchpad.knowledgeSidecar.lastTurn).toEqual(saved); expect(broken.state.provenance).toEqual([]);
});
test('last-turn UI is honest about empty/legacy/error states and escapes counter input',async()=>{
 const source=await Bun.file(new URL('./src/knowledge/agentMetaSection.ts',import.meta.url)).text();
 const render=new Function(new Bun.Transpiler({loader:'ts'}).transformSync(source).replace('export default','return'))();
 const ctx={fns:{procs:{ui:{escape:({text}:any)=>Bun.escapeHTML(text)}}, w: {escape:({text}:any)=>Bun.escapeHTML(text)},ui:{toggle:()=>''}}};
 const show=(knowledgeSidecar:any)=>render(ctx,null,{agent:{id:'parent',scratchpad:{knowledgeTrackingEnabled:true,knowledgeSidecar}}});
 expect(show({})).not.toContain('Last successful turn');
 const html=show({status:'error',error:'<bad>',lastTurn:{sourceMessageIdx:3,matched:'<img>',created:0,facts:{}}});
 expect(html).toContain('Last successful turn · message 3'); expect(html).toContain('0 matched'); expect(html).toContain('&lt;bad&gt;'); expect(html).not.toContain('<img>'); expect(html).toContain('not all observations below');
});
