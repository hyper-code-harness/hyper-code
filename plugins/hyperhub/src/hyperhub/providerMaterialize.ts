/**
 * Materializes a pinned HyperHub Git tree into inert core staging
 *
 * Use only for provider retrieval into a core-created empty destination. Verifies exact registry and fetched commit identity, bounds file counts and sizes, rejects unsafe tree modes and installation metadata, and never activates or loads plugin code.
 * @param opts.selection HyperHub selection containing an immutable commit revision and source baseUrl, repo and optional path.
 * @param opts.destination Absolute canonical empty staging directory owned by core lifecycle.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** HyperHub selection containing an immutable commit revision and source baseUrl, repo and optional path. */
        selection: types.plugins.ProviderSelection;
        /** Absolute canonical empty staging directory owned by core lifecycle. */
        destination: string;
    },
): Promise<{path:string}> {
    const fs=await import('node:fs/promises'),path=await import('node:path');
    const s=opts.selection,{baseUrl,repo}=s.source,commit=s.revision;
    if(typeof baseUrl!=='string'||s.provider!=='hyperhub'||!/^[a-z][a-z0-9-]{0,63}$/.test(s.name)||typeof repo!=='string'||repo.length>240||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(repo)||!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))throw new Error('Unsafe HyperHub selection');
    const origin=new URL(baseUrl);if(origin.protocol!=='https:'||origin.username||origin.password||origin.href!==origin.origin+'/')throw new Error('Credential-free HTTPS origin required');
    if(!path.isAbsolute(opts.destination))throw new Error('Absolute staging destination required');
    const dst=await fs.lstat(opts.destination);if(!dst.isDirectory()||dst.isSymbolicLink()||await fs.realpath(opts.destination)!==opts.destination||(await fs.readdir(opts.destination)).length)throw new Error('Empty regular canonical staging destination required');
    const resolved=await ctx.fns.hyperhub.resolve({baseUrl,repo,name:s.name,commit});
    const p=resolved.plugin as {name:string;repo:string;commit:string;path:string};
    if(!p||p.name!==s.name||p.repo!==repo||p.commit!==commit)throw new Error('Registry mismatch');
    if(typeof p.path!=='string'||(p.path!=='.'&&(p.path.length>200||!p.path.split('/').every(part=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part)&&part!=='.'&&part!=='..')))||(s.source.path!==undefined&&s.source.path!==p.path))throw new Error('Unsafe or mismatched plugin path');
    const stage=await fs.mkdtemp(path.join(path.dirname(opts.destination),'.hyperhub-fetch-'));
    try {
     const git=path.join(stage,'repo.git');
     await ctx.fns.hyperhub.command({dir:stage,args:['init','--bare',git]});
     await ctx.fns.hyperhub.command({dir:git,args:['fetch','--depth=1','--no-tags','--',new URL('/git/'+repo+'.git',baseUrl).href,commit]});
     const fetched=await ctx.fns.hyperhub.command({dir:git,args:['rev-parse','--verify','FETCH_HEAD^{commit}']});
     if(fetched.trim()!==commit)throw new Error('Fetched commit mismatch');
     const tree=commit+(p.path==='.'?'':':'+p.path);
     const listing=await ctx.fns.hyperhub.command({dir:git,args:['ls-tree','-rzl','--full-tree',tree]});
     const entries=listing.split('\0').filter(Boolean);if(entries.length>2000)throw new Error('Too many files');
     let bytes=0;
     for(const entry of entries){
      const match=/^(100644|100755) blob [0-9a-f]+ +([0-9]+)\t(.+)$/.exec(entry),file=match?.[3];
      if(!file||file.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\r\n]/.test(file))throw new Error('Unsafe Git tree');
      if(file.split('/').some(x=>x==='.plugin-lock.json'||x==='.hyperhub-lock.json'||x==='.git'))throw new Error('Registry source must not contain installation provenance or Git metadata');
      const size=Number(match?.[2]);if(size>2_000_000||(bytes+=size)>20_000_000)throw new Error('Plugin exceeds size limit');
     }
     const archive=path.join(stage,'plugin.tar');
     await ctx.fns.hyperhub.command({dir:git,args:['archive','--format=tar','--output='+archive,tree]});
     if((await fs.stat(archive)).size>25_000_000)throw new Error('Archive too large');
     const tar=Bun.spawn(['tar','-xf',archive,'-C',opts.destination],{stdout:'ignore',stderr:'ignore'}),timer=setTimeout(()=>tar.kill(),30_000);
     try{if(await tar.exited!==0)throw new Error('Extraction failed');}finally{clearTimeout(timer);}
     return {path:opts.destination};
    }finally{await fs.rm(stage,{recursive:true,force:true});}
}
