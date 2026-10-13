/**
 * Previews or activates provider-pinned plugin installation update and rollback
 *
 * Stages inert bounded candidates outside mounts, requires fresh reviewed approval, rejects drift and namespace collisions, preserves legacy snapshots and truthfully reports partial load failures.
 * @param opts.operation Managed lifecycle action to preview or approve.
 * @param opts.selection Provider source and immutable revision to review.
 * @param opts.confirmed True only following explicit approval to execute reviewed code. @default false
 * @param opts.expectedDigest Exact destination-bound digest returned by reviewed preview.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Managed lifecycle action to preview or approve. */
        operation: 'install'|'update'|'rollback';
        /** Provider source and immutable revision to review. */
        selection: types.plugins.ProviderSelection;
        /** True only following explicit approval to execute reviewed code. @default false */
        confirmed?: boolean;
        /** Exact destination-bound digest returned by reviewed preview. */
        expectedDigest?: string;
    },
): Promise<{name:string;src:string;files:string[];selection:types.plugins.ProviderSelection;revision:string;commit:string;previousRevision?:string;previousCommit?:string;digest:string;activated:boolean;destination:string;diff:{added:string[];removed:string[];changed:string[]};review:{files:Array<{path:string;text:string;truncated:boolean}>;truncated:boolean};loadError?:string;status:string}> {
    const fs=await import('node:fs/promises');const path=await import('node:path');
    const {selection,operation}=opts; const name=selection.name;
    if(!['install','update','rollback'].includes(operation)||! /^[a-z][a-z0-9-]{0,63}$/.test(name)||!selection.provider||!selection.revision||!selection.source||Object.values(selection.source).some(x=>typeof x!=='string'))throw new Error('Invalid selection');
    const stable=(s:types.plugins.ProviderSelection)=>JSON.stringify([s.provider,s.name,s.revision,Object.entries(s.source).sort(([a],[b])=>a.localeCompare(b))]);
    async function provenance(dir:string){
     const read=async(file:string)=>{try{return await ctx.fns.plugins.readMetadata({path:path.join(dir,file)});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
     const neutral=await read('.plugin-lock.json');const legacy=await read('.hyperhub-lock.json');if(neutral&&legacy)throw new Error('Conflicting provenance files');const raw=neutral??legacy;if(!raw)return null;
     const selected=neutral?raw.selection:{provider:'hyperhub',name:raw.name,revision:raw.commit,source:{baseUrl:raw.origin,repo:raw.repo,...(raw.path?{path:raw.path}:{})}};
     const s=selected as types.plugins.ProviderSelection;if(!s||s.name!==name||typeof s.provider!=='string'||typeof s.revision!=='string'||!s.source||Object.values(s.source).some(v=>typeof v!=='string'))throw new Error('Invalid provenance');
     return {selection:s,contentDigest:raw.contentDigest,previousSnapshot:raw.previousSnapshot,previousSelection:(neutral?raw.previousSelection:raw.previousCommit?{...s,revision:raw.previousCommit}:undefined) as types.plugins.ProviderSelection|undefined,raw};
    }
    const mount=ctx.env.USER_PLUGINS;if(!mount||!path.isAbsolute(mount))throw new Error('Absolute USER_PLUGINS required');await fs.mkdir(mount,{recursive:true});const root=await fs.realpath(mount);const destination=path.join(root,name);const lock=path.join(root,'.registry-install-lock');await fs.mkdir(lock);let stage='';
    try{
     const exists=await fs.lstat(destination).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(operation==='install'&&exists)throw new Error('Destination exists');if(operation!=='install'&&(!exists||exists.isSymbolicLink()||!exists.isDirectory()))throw new Error('Managed regular plugin directory required');
     const previous=operation==='install'?null:await provenance(destination);let oldTree:Awaited<ReturnType<typeof ctx.fns.plugins.validateTree>>|undefined;
     if(operation!=='install'){
     if(!previous||previous.selection.provider!==selection.provider||JSON.stringify(Object.entries(previous.selection.source).sort())!==JSON.stringify(Object.entries(selection.source).sort()))throw new Error('Installed provenance mismatch');
     if(typeof previous.contentDigest!=='string'||!/^[0-9a-f]{64}$/.test(previous.contentDigest))throw new Error('Legacy installation needs independent verification; automatic adoption refused');oldTree=await ctx.fns.plugins.validateTree({dir:destination});if(oldTree.digest!==previous.contentDigest)throw new Error('Local modifications detected');
     }
     const backupRoot=path.join(path.dirname(root),'.hyperhub-backups');stage=await fs.mkdtemp(path.join(path.dirname(root),'.plugin-stage-'));const content=path.join(stage,'content');
     if(operation==='rollback'){
     if(typeof previous?.previousSnapshot!=='string'||! /^[a-z0-9-]+$/.test(previous.previousSnapshot))throw new Error('No saved previous snapshot');const backup=path.join(backupRoot,previous.previousSnapshot);if(await fs.realpath(backupRoot)!==backupRoot||await fs.realpath(backup)!==backup)throw new Error('Unsafe backup location');const saved=await provenance(backup);if(!saved||stable(saved.selection)!==stable(selection)||typeof saved.contentDigest!=='string')throw new Error('Snapshot provenance mismatch');const before=await ctx.fns.plugins.validateTree({dir:backup});if(before.digest!==saved.contentDigest)throw new Error('Saved snapshot modified');await fs.cp(backup,content,{recursive:true,dereference:false});if((await ctx.fns.plugins.validateTree({dir:content})).digest!==before.digest)throw new Error('Snapshot changed while copying');await fs.rm(path.join(content,'.plugin-lock.json'),{force:true});await fs.rm(path.join(content,'.hyperhub-lock.json'),{force:true});
     }else{
     await fs.mkdir(content);const materialized=await ctx.fns.plugins.dispatch({provider:selection.provider,operation:'materialize',args:{selection,destination:content}}) as {path:string};if(materialized.path!==content||await fs.realpath(content)!==content)throw new Error('Provider returned an unsafe candidate path');
     for(const file of ['.plugin-lock.json','.hyperhub-lock.json'])if(await fs.lstat(path.join(content,file)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw new Error('Candidate contains installation provenance');
     }
     const v=await ctx.fns.plugins.validateTree({dir:content});if(v.name!==name)throw new Error('Manifest name mismatch');
     for(const e of await fs.readdir(path.join(content,v.src),{withFileTypes:true})){if(!e.isDirectory())throw new Error('Managed source root must contain namespace directories only');if(e.name==='procs')throw new Error('Reserved namespace');if(Object.keys(ctx.fns).includes(e.name)){const owners=ctx.state.procs.modules.filter(m=>m.namespaces.includes(e.name));if(operation==='install'||!owners.length||owners.some(m=>path.resolve(m.dir)!==destination))throw new Error('Namespace collision: '+e.name);for(const fn of Object.keys(ctx.fns[e.name as keyof typeof ctx.fns])){const meta=await ctx.fns.runtime.docs.get({name:e.name+'.'+fn});if(!meta?.abs||!path.resolve(meta.abs).startsWith(destination+path.sep))throw new Error('Namespace contains foreign function: '+e.name+'.'+fn);}}}
     const added=v.files.filter(f=>!oldTree?.files.includes(f));const removed=(oldTree?.files??[]).filter(f=>!v.files.includes(f));const changed:string[]=[];for(const file of v.files)if(oldTree?.files.includes(file)&&!(await fs.readFile(path.join(content,file))).equals(await fs.readFile(path.join(destination,file))))changed.push(file);
     const digest=new Bun.CryptoHasher('sha256').update(JSON.stringify([operation,stable(selection),destination,v.digest,previous?.raw??null])).digest('hex');let reviewBytes=0;const reviewFiles:Array<{path:string;text:string;truncated:boolean}>=[];for(const file of v.files){const data=await fs.readFile(path.join(content,file));const take=Math.min(data.length,500000,Math.max(0,2000000-reviewBytes));reviewBytes+=take;reviewFiles.push({path:file,text:data.subarray(0,take).toString('utf8'),truncated:take<data.length});}let loadError:string|undefined;
     if(opts.confirmed){if(opts.expectedDigest!==digest)throw new Error('Preview digest mismatch');if((await ctx.fns.plugins.validateTree({dir:content})).digest!==v.digest)throw new Error('Candidate changed before activation');let snapshot:string|undefined;if(previous){if((await ctx.fns.plugins.validateTree({dir:destination})).digest!==previous.contentDigest||JSON.stringify((await provenance(destination))?.raw)!==JSON.stringify(previous.raw))throw new Error('Installed tree or provenance changed before activation');await fs.mkdir(backupRoot,{recursive:true});if(await fs.realpath(backupRoot)!==backupRoot)throw new Error('Unsafe backup root');snapshot=name+'-'+Bun.randomUUIDv7();}
     await fs.writeFile(path.join(content,'.plugin-lock.json'),JSON.stringify({selection,contentDigest:v.digest,digest,previousSnapshot:snapshot,previousSelection:previous?.selection},null,2)+'\n',{flag:'wx'});if(snapshot)await fs.rename(destination,path.join(backupRoot,snapshot));try{await fs.rename(content,destination);}catch(cause){if(snapshot)try{await fs.rename(path.join(backupRoot,snapshot),destination);}catch(restore){throw new Error('Activation and restore failed; backup at '+path.join(backupRoot,snapshot),{cause:restore});}throw cause;}
     try{await ctx.fns.plugins.load({path:destination,name});}catch(cause){loadError='Plugin files installed but runtime loading failed; runtime and external side effects may be partial. '+(cause instanceof Error?cause.name:'Error');}
     }
     return {...v,selection,revision:selection.revision,commit:selection.revision,previousRevision:previous?.selection.revision,previousCommit:previous?.selection.revision,digest,activated:!!opts.confirmed&&!loadError,destination,diff:{added,removed,changed},review:{files:reviewFiles,truncated:reviewFiles.some(f=>f.truncated)},loadError,status:opts.confirmed?(loadError?'installed-load-failed':'active'):'preview'};
    }finally{try{if(stage)await fs.rm(stage,{recursive:true,force:true});}finally{await fs.rmdir(lock);}}
}
