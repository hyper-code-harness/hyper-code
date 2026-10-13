/**
 * Lists offline installed plugins with neutral or legacy provenance and drift status
 *
 * Reads local metadata and bounded trees without contacting providers or executing code. Conflicting locks are invalid; legacy installations without content SHA256 remain untrusted.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{plugins:Array<{name:string;selection?:types.plugins.ProviderSelection;previousSelection?:types.plugins.ProviderSelection;version?:string;label?:string;description?:string;icon?:string;managed:boolean;status:string;modified?:boolean;baseUrl?:string;repo?:string;commit?:string;previousCommit?:string}>;errors:string[]}> {
    const fs=await import('node:fs/promises');const path=await import('node:path');const plugins:Array<{name:string;selection?:types.plugins.ProviderSelection;previousSelection?:types.plugins.ProviderSelection;version?:string;label?:string;description?:string;icon?:string;managed:boolean;status:string;modified?:boolean;baseUrl?:string;repo?:string;commit?:string;previousCommit?:string}>=[];const errors:string[]=[];const mount=ctx.env.USER_PLUGINS;if(!mount)return {plugins,errors};let entries;try{entries=await fs.readdir(mount,{withFileTypes:true});}catch(e){return {plugins,errors:['Inventory unavailable']};}
    for(const entry of entries){const name=entry.name;if(name.startsWith('.'))continue;if(!entry.isDirectory()||entry.isSymbolicLink()){plugins.push({name,managed:false,status:'invalid'});continue;}const dir=path.join(mount,name);let metadata:{version?:string;label?:string;description?:string;icon?:string}={};try{
     const pkg=await ctx.fns.plugins.readMetadata({path:path.join(dir,'package.json')});const procs=pkg.procs&&typeof pkg.procs==='object'&&!Array.isArray(pkg.procs)?pkg.procs:{};metadata={version:typeof pkg.version==='string'?pkg.version:undefined,label:typeof procs.label==='string'?procs.label:undefined,description:typeof procs.description==='string'?procs.description:typeof pkg.description==='string'?pkg.description:undefined,icon:typeof procs.icon==='string'?procs.icon:undefined};const read=async(file:string)=>{try{return await ctx.fns.plugins.readMetadata({path:path.join(dir,file)});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};const neutral=await read('.plugin-lock.json');const legacy=await read('.hyperhub-lock.json');if(neutral&&legacy)throw new Error('Conflicting provenance');const lock=neutral??legacy;const version=typeof pkg.version==='string'?pkg.version:undefined;if(!lock){plugins.push({name,...metadata,version,managed:false,status:'unmanaged'});continue;}
     const selection=(neutral?lock.selection:{provider:'hyperhub',name:lock.name,revision:lock.commit,source:{baseUrl:lock.origin,repo:lock.repo,...(lock.path?{path:lock.path}:{})}}) as types.plugins.ProviderSelection;
     if(!selection||selection.name!==name||typeof selection.provider!=='string'||typeof selection.revision!=='string'||!selection.source||typeof selection.source!=='object'||Array.isArray(selection.source)||Object.values(selection.source).some(v=>typeof v!=='string'))throw new Error('Invalid provenance');
     const previousSelection=(neutral?lock.previousSelection:lock.previousCommit?{...selection,revision:lock.previousCommit}:undefined) as types.plugins.ProviderSelection|undefined;
     const hasDigest=typeof lock.contentDigest==='string'&&/^[0-9a-f]{64}$/.test(lock.contentDigest);const modified=hasDigest?(await ctx.fns.plugins.validateTree({dir})).digest!==lock.contentDigest:undefined;
     plugins.push({name,...metadata,version,selection,previousSelection,managed:hasDigest,status:hasDigest?(modified?'modified':'managed'):'legacy',modified,baseUrl:selection.source.baseUrl,repo:selection.source.repo,commit:selection.revision,previousCommit:previousSelection?.revision});
     }catch(e){plugins.push({name,...metadata,managed:false,status:'invalid'});errors.push(name+': Invalid local metadata or tree');}}
    return {plugins,errors};
}
