import { expect, test } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("createFunction requires complete authoring metadata", async () => {
    await expect(ctx.fns.procs.dev.createFunction({ module: "demo", name: "ping", summary: "Short", description: "Too short", params: [], returnType: "Promise<string>", body: "return 'pong';", dryRun: true })).rejects.toThrow("summary");
});

test("createFunction dry run renders documented typed source without writing", async () => {
    const result = await ctx.fns.procs.dev.createFunction({
        module: "demo", name: "lookup", summary: "Looks up one documented record",
        description: "Use this function to retrieve one record by its stable identifier.",
        params: [{ name: "id", type: "string", required: true, description: "Stable record identifier." }],
        returnType: "Promise<string>", body: "return opts.id;", dryRun: true,
    });
    expect(result.written).toBe(false);
    expect(result.source).toContain("@param opts.id Stable record identifier.");
    expect(result.source).toContain("id: string;");
    expect(await Bun.file(`${ctx.state.root}/src/demo/lookup.ts`).exists()).toBe(false);
});

test("createFunction refuses an existing function without overwrite", async () => {
    await expect(ctx.fns.procs.dev.createFunction({
        module: "agent", name: "reflect", summary: "Reflects over an agent conversation",
        description: "Use this function to reflect over recent messages for an existing agent.",
        params: [], returnType: "Promise<void>", body: "return;",
    })).rejects.toThrow("already exists");
});


const authoring = {module:'demo',name:'ping',summary:'Returns a synthetic test response',description:'Use this synthetic procedure to verify safe source-root authoring.',params:[],returnType:'Promise<string>',body:"return 'pong';",dryRun:true};
test('createFunction supports src, .hyper and mounted official source roots',async()=>{
 for(const root of ['src','.hyper','plugin:flow','plugins/flow/src']) {
  const result=await ctx.fns.procs.dev.createFunction({...authoring,root});
  expect(result.ok).toBe(true);expect(result.path).toBe(`${root}/demo/ping.ts`);
 }
});
test('createFunction rejects unmounted roots, absolute paths and traversal',async()=>{
 for(const root of ['/tmp','../src','plugin:../../bad','plugins/flow/../../src','plugin:unmountedExample']) await expect(ctx.fns.procs.dev.createFunction({...authoring,root})).rejects.toThrow();
 for(const module of ['../outside','demo/../../bad','/tmp/demo']) await expect(ctx.fns.procs.dev.createFunction({...authoring,module})).rejects.toThrow('module');
});
test('createFunction selects user plugin source by registered name, not arbitrary path',async()=>{
 const raw=(await import('./createFunction')).default;
 const mock:any={fns:{procs:{project:{projectRoot:()=>'/tmp'},modules:{discover:async()=>[{name:'private',source:'user',dir:'/tmp',prefix:undefined}]}}}};
 expect((await raw(mock,null,{...authoring,root:'plugin:private'})).ok).toBe(true);
});


test('createFunction rejects symlink module escape from selected source',async()=>{
 const fs=await import('node:fs/promises');const project=await fs.mkdtemp('/tmp/authoring-symlink-');
 try {await fs.mkdir(`${project}/src`);await fs.symlink('/tmp',`${project}/src/demo`);
 const raw=(await import('./createFunction')).default;
 const mock:any={fns:{procs:{project:{projectRoot:()=>project}}}};
 await expect(raw(mock,null,authoring)).rejects.toThrow('symlink');
 }finally{await fs.rm(project,{recursive:true,force:true});}
});
test('createFunction preflight stages external plugin code inside checked host src',async()=>{
 const fs=await import('node:fs/promises');const project=await fs.mkdtemp('/tmp/authoring-preflight-');
 try {await fs.mkdir(`${project}/src`);await fs.mkdir(`${project}/private/src`,{recursive:true});let checked='';
 const raw=(await import('./createFunction')).default;
 const mock:any={fns:{procs:{project:{projectRoot:()=>project},modules:{discover:async()=>[{name:'private',source:'user',dir:`${project}/private/src`}]},dev:{typecheck:async({filter}:any)=>{checked=filter;return {ok:false,errors:['intentional test rejection']};}}}}};
 await expect(raw(mock,null,{...authoring,root:'plugin:private',dryRun:false})).rejects.toThrow('typecheck failed');
 expect(checked).toStartWith('src/.authoring/');expect(await Bun.file(`${project}/private/src/demo/ping.ts`).exists()).toBe(false);
 }finally{await fs.rm(project,{recursive:true,force:true});}
});
