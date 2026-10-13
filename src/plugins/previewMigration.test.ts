import { expect, test } from 'bun:test';
import previewMigration from './previewMigration';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(run: (f: {dir:string;ctx:any;declare:(v:Record<string,unknown>)=>Promise<void>;plugin:(name:string, optional?:boolean)=>Promise<string>})=>Promise<void>) {
 const dir=await realpath(await mkdtemp(join(tmpdir(),'preview-migration-')));
 const search=join(dir,'plugins'); await mkdir(search);
 await writeFile(join(dir,'package.json'),JSON.stringify({procs:{}}));
 let declared:Record<string,unknown>={};
 const forbidden=()=>{throw new Error('Forbidden mutation or settings read');};
 const ctx:any={state:{procs:{modules:[],boot:{}}},fns:{settings:new Proxy({},{get:()=>forbidden}),procs:{project:{projectRoot:()=>dir,workdir:()=>dir},modules:{paths:()=>[{dir:search,kind:'official',prefixed:false}],readDeclared:()=>declared}},plugins:{}}};
 const declare=async(v:Record<string,unknown>)=>{declared=v;await writeFile(join(dir,'workspace.json'),JSON.stringify({modules:v}));};
 const plugin=async(name:string,optional=false)=>{const path=join(search,name);await mkdir(path);await mkdir(join(path,'src'));await writeFile(join(path,'package.json'),JSON.stringify({procs:{plugin:true,optional}}));return path;};
 try {await run({dir,ctx,declare,plugin});} finally {await rm(dir,{recursive:true,force:true});}
}

test('read-only preview preserves mounted order/source and includes known disabled candidates',()=>fixture(async({dir,ctx,plugin,declare})=>{
 const b=await plugin('b');const a=await plugin('a');const c=await plugin('c',true);
 ctx.state.procs.modules=[{name:'b',dir:b,source:'user',plugin:true},{name:'a',dir:a,source:'official',plugin:true}];
 await declare({c:false});
 const before=await Bun.file(join(dir,'workspace.json')).text();const files=await readdir(dir);const state=JSON.stringify(ctx.state);
 const out=await previewMigration(ctx,null,{});
 expect(out.ready).toBe(true);expect(out.pluginRegistry).toEqual({version:1,entries:[{path:b,enabled:true},{path:a,enabled:true},{path:c,enabled:false}]});
 expect(out.roots.map(r=>r.source)).toEqual(['user','official','official']);expect(out.restartRequired).toBe(true);expect(out.readOnly).toBe(true);
 expect(await Bun.file(join(dir,'workspace.json')).text()).toBe(before);expect(await readdir(dir)).toEqual(files);expect(JSON.stringify(ctx.state)).toBe(state);
}));

test('config values never appear and unresolved declarations block',()=>fixture(async({ctx,plugin,declare})=>{
 const a=await plugin('a');ctx.state.procs.modules=[{name:'a',dir:a,source:'user',plugin:true}];
 await declare({a:{token:'TOP_SECRET',prefix:'SECRET_PREFIX'},missing:{git:'https://SECRET_CREDENTIAL@example.test/private'}});
 const out=await previewMigration(ctx,null,{});expect(out.ready).toBe(false);expect(out.blockers.map(b=>b.code)).toContain('legacy-config');expect(out.blockers.map(b=>b.code)).toContain('unresolved-declaration');expect(JSON.stringify(out)).not.toContain('SECRET');
}));

test('aliases prefixes mixed override order and baked execution block',()=>fixture(async({ctx,plugin})=>{
 const a=await plugin('a');ctx.state.procs.modules=[{name:'alias',dir:a,source:'user',plugin:true,prefix:'prefixed'},{name:'core-module',dir:'/ignored',source:'core'}];ctx.state.procs.boot.baked=[{}];
 const out=await previewMigration(ctx,null,{});expect(out.ready).toBe(false);for(const code of ['alias','prefix','mixed-order','baked-runtime'])expect(out.blockers.map(b=>b.code)).toContain(code);
}));

test('malformed declarations and existing registry fail closed without calling declaration reader',()=>fixture(async({ctx,dir})=>{
 await writeFile(join(dir,'workspace.json'),JSON.stringify({modules:[],pluginRegistry:{version:1,entries:[]}}));ctx.fns.procs.modules.readDeclared=()=>{throw new Error('must not read invalid config');};
 const out=await previewMigration(ctx,null,{});expect(out.ready).toBe(false);expect(out.blockers.map(b=>b.code)).toContain('invalid-config');expect(out.blockers.map(b=>b.code)).toContain('registry-present');
}));

test('malformed JSON returns sanitized blockers',()=>fixture(async({ctx,dir})=>{
 await writeFile(join(dir,'workspace.json'),'{"secret":"DO_NOT_PRINT",');const out=await previewMigration(ctx,null,{});expect(out.ready).toBe(false);expect(JSON.stringify(out)).not.toContain('DO_NOT_PRINT');expect(out.blockers.map(b=>b.code)).toContain('invalid-manifest');
}));

test('unmounted enabled candidate and realpath alias are not silently accepted',()=>fixture(async({ctx,plugin,dir})=>{
 const a=await plugin('a');await symlink(a,join(dir,'plugins','alias'));const out=await previewMigration(ctx,null,{});expect(out.ready).toBe(false);expect(out.blockers.map(b=>b.code)).toContain('runtime-drift');expect(out.pluginRegistry.entries).toHaveLength(1);
}));
