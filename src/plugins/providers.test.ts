import { expect, test } from 'bun:test';
import providers from './providers';
import dispatch from './dispatch';
import loader from './$loader_plugin';
import { mkdtemp, realpath, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
 const selection = {provider:'sample',name:'example',revision:'sha256:abc',source:{url:'https://example.test'}};
 const descriptor:any = {kind:'plugin',name:'provider_sample',root:'sample',rootDir:'/sample/src',abs:'/sample/src/sample/$plugin_provider_sample.ts',moduleDir:'sample',fn:{apiVersion:1,label:'Sample',description:'Source',handlers:{search:'sample.search',materialize:'sample.materialize'}}};
 const entry = (name:string)=>({kind:'fn',root:'sample',rootDir:'/sample/src',abs:'/sample/src/sample/'+name+'.ts',moduleDir:'sample',runtimeName:name});
 const calls:any[]=[];
 const search = Object.assign(async (args:any)=>{calls.push(args);return {items:[{selection}],errors:[]};},{meta:{abs:entry('search').abs}});
 const materialize = Object.assign(async (args:any)=>{calls.push(args);await writeFile(join(args.destination,'inert.ts'),'export default {}');return {path:args.destination};},{meta:{abs:entry('materialize').abs}});
 const modules:any[]=[{name:'sample',dir:'/sample'}];
 const ctx:any={state:{registry:{sample:{search,materialize}},procs:{boot:{entries:[descriptor,entry('search'),entry('materialize')]}}},fns:{sample:{search,materialize},procs:{modules:{list:()=>modules}},plugins:{}}};
 ctx.fns.plugins.providers=()=>providers(ctx,null,{});
 return {ctx,descriptor,modules,selection,calls};
}

test('no provider plugin is required, removed owner and removed entries disappear',async()=>{
 const f=fixture(); expect((await providers(f.ctx,null,{}))[0].id).toBe('sample');
 f.modules.length=0;expect(await providers(f.ctx,null,{})).toEqual([]);
 await expect(dispatch(f.ctx,null,{provider:'sample',operation:'search',args:{}})).rejects.toThrow('Missing');
 f.modules.push({name:'sample',dir:'/sample'}); f.ctx.state.procs.boot.entries=[];
 expect(await providers(f.ctx,null,{})).toEqual([]);
});
test('duplicates malformed missing and foreign handlers fail closed',async()=>{
 const f=fixture();f.ctx.state.procs.boot.entries.push({...f.descriptor});await expect(providers(f.ctx,null,{})).rejects.toThrow('Duplicate');
 f.ctx.state.procs.boot.entries.pop();f.descriptor.fn.apiVersion=2;await expect(providers(f.ctx,null,{})).rejects.toThrow('Malformed');
 f.descriptor.fn.apiVersion=1;f.descriptor.fn.handlers.search='foreign.search';await expect(providers(f.ctx,null,{})).rejects.toThrow('Foreign or missing');
 f.descriptor.fn.handlers.search='sample.search';f.modules.push({name:'foreign',dir:'/foreign'});f.ctx.state.procs.boot.entries.push({kind:'fn',root:'foreign',rootDir:'/foreign/src',moduleDir:'sample',runtimeName:'search',abs:'/foreign/src/sample/search.ts'});await expect(providers(f.ctx,null,{})).rejects.toThrow('Foreign');
});
test('missing or stale live handler metadata rejected',async()=>{
 const f=fixture();f.ctx.state.registry.sample.search.meta.abs='/foreign/search.ts';await expect(providers(f.ctx,null,{})).rejects.toThrow('Stale');
 delete f.ctx.state.registry.sample.search.meta;await expect(providers(f.ctx,null,{})).rejects.toThrow('Stale');
});
test('full and singleton loader calls reconcile entire current snapshot',async()=>{
 const f=fixture();await loader(f.ctx,null,{entries:[f.descriptor]});await loader(f.ctx,null,{entries:[]});expect(await providers(f.ctx,null,{})).toHaveLength(1);
 f.ctx.state.procs.boot.entries=[];await loader(f.ctx,null,{entries:[f.descriptor]});expect(await providers(f.ctx,null,{})).toEqual([]);
});
test('safe search dispatch bounds args and validates pinned provider identity',async()=>{
 const f=fixture();expect(await dispatch(f.ctx,null,{provider:'sample',operation:'search',args:{q:'x',limit:2}})).toEqual({items:[{selection:f.selection}],errors:[]});expect(f.calls).toEqual([{q:'x',limit:2}]);
 for(const args of [{limit:101},{limit:0},{q:'x'.repeat(2001)},{handler:'sample.materialize'}])await expect(dispatch(f.ctx,null,{provider:'sample',operation:'search',args} as any)).rejects.toThrow('arguments');
 await expect(dispatch(f.ctx,null,{provider:'sample',operation:'evil',args:{}} as any)).rejects.toThrow('operation');
 f.selection.provider='foreign';await expect(dispatch(f.ctx,null,{provider:'sample',operation:'search',args:{}})).rejects.toThrow('Malformed provider item');
});
test('materialization writes inert code only into supplied empty real directory',async()=>{
 const f=fixture();const root=await realpath(await mkdtemp(join(tmpdir(),'provider-test-')));const dest=join(root,'stage');await mkdir(dest);
 try {
 expect(await dispatch(f.ctx,null,{provider:'sample',operation:'materialize',args:{selection:f.selection,destination:dest}})).toEqual({path:dest});
 await expect(dispatch(f.ctx,null,{provider:'sample',operation:'materialize',args:{selection:f.selection,destination:dest}})).rejects.toThrow('empty');
 const target=join(root,'other');await mkdir(target);const link=join(root,'link');await symlink(target,link);await expect(dispatch(f.ctx,null,{provider:'sample',operation:'materialize',args:{selection:f.selection,destination:link}})).rejects.toThrow('empty');
 f.ctx.fns.sample.materialize=async()=>({path:root});await expect(dispatch(f.ctx,null,{provider:'sample',operation:'materialize',args:{selection:f.selection,destination:target}})).rejects.toThrow('escaped');
 } finally {await rm(root,{recursive:true,force:true});}
});

test('singleton edit keeps other declarations and cannot resurrect unmounted owner', async()=>{
 const f=fixture();const second={...f.descriptor,abs:'/sample/src/sample/$plugin_provider_second.ts',name:'provider_second'};f.ctx.state.procs.boot.entries.push(second);
 await loader(f.ctx,null,{entries:[{kind:'plugin',name:f.descriptor.name,abs:f.descriptor.abs,fn:{...f.descriptor.fn,label:'Edited'}}]});
 expect((await providers(f.ctx,null,{})).map(p=>p.label)).toEqual(['Edited','Sample']);
 f.modules.length=0;await loader(f.ctx,null,{entries:[f.descriptor]});expect(await providers(f.ctx,null,{})).toEqual([]);
});
test('custom source root remains owned and unsafe configuration links are rejected', async()=>{
 const f=fixture();for(const e of f.ctx.state.procs.boot.entries){e.rootDir='/sample/custom/code';e.abs=e.abs.replace('/sample/src','/sample/custom/code');}
 f.ctx.state.registry.sample.search.meta.abs='/sample/custom/code/sample/search.ts';f.ctx.state.registry.sample.materialize.meta.abs='/sample/custom/code/sample/materialize.ts';
 expect(await providers(f.ctx,null,{})).toHaveLength(1);
 for(const href of ['/\\\\evil.example','//evil.example','/\nevil','https://evil.example']){f.descriptor.fn.configurationHref=href;await expect(providers(f.ctx,null,{})).rejects.toThrow('Malformed');}
 f.descriptor.fn.configurationHref='/sample/config';expect((await providers(f.ctx,null,{}))[0].configurationHref).toBe('/sample/config');
});

test('classified dev.sync singleton imports changed descriptor using current boot ownership',async()=>{
 const f=fixture();const root=await realpath(await mkdtemp(join(tmpdir(),'provider-reload-')));const abs=join(root,'$plugin_provider_sample.ts');
 try {
  await writeFile(abs,`export default ${JSON.stringify({...f.descriptor.fn,label:'Reloaded from disk'})};`);
  f.modules[0].dir=root;for(const e of f.ctx.state.procs.boot.entries){e.rootDir=root;e.abs=join(root,e.runtimeName?e.runtimeName+'.ts':'$plugin_provider_sample.ts');}
  f.ctx.state.registry.sample.search.meta.abs=join(root,'search.ts');f.ctx.state.registry.sample.materialize.meta.abs=join(root,'materialize.ts');
  await loader(f.ctx,null,{entries:[{kind:'plugin',name:'provider_sample',abs}]});expect((await providers(f.ctx,null,{}))[0].label).toBe('Reloaded from disk');
 } finally {await rm(root,{recursive:true,force:true});}
});
