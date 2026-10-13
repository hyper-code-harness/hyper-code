/**
 * Searches configured HyperHub registries as a core plugin provider
 *
 * Use for read-only discovery across at most eight enabled hubs with three concurrent workers. Returns at most twenty immutable selections, preserving source identity and attributed failures.
 * @param opts.q Registry search text.
 * @param opts.limit Maximum combined result count. @default 20 @minimum 1 @maximum 20
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Registry search text. */
        q?: string;
        /** Maximum combined result count. @default 20 @minimum 1 @maximum 20 */
        limit?: number;
    },
): Promise<{items:types.plugins.ProviderItem[];errors:string[]}> {
    const limit=Math.min(20,Math.max(1,Math.floor(opts.limit??20)));
    if(!Number.isFinite(limit))throw new Error('Invalid limit');
    const hubs=(await ctx.fns.hyperhub.configuredHubs({})).filter(h=>h.enabled).slice(0,8);
    const results:Array<{items:types.plugins.ProviderItem[];errors:string[]}>=new Array(hubs.length);let next=0;
    await Promise.all(Array.from({length:Math.min(3,hubs.length)},async()=>{while(next<hubs.length){
     const i=next++,h=hubs[i]!;const items:types.plugins.ProviderItem[]=[],errors:string[]=[];
     try {
      const r=await ctx.fns.hyperhub.search({baseUrl:h.origin,repo:h.repo,q:opts.q,limit});
      if(!Array.isArray(r.plugins))throw new Error('Invalid registry response');
      for(const row of r.plugins.slice(0,20)){
       if(!row||typeof row!=='object'||typeof row.name!=='string'||typeof row.repo!=='string'||typeof row.commit!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(row.name)||!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.commit)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/.test(row.repo)){errors.push(h.origin+': Invalid plugin selection');continue;}
       const source:Record<string,string>={baseUrl:h.origin,repo:row.repo};if(typeof row.path==='string')source.path=row.path;
       const item:types.plugins.ProviderItem={selection:{provider:'hyperhub',name:row.name,revision:row.commit,source},label:row.name};
       for(const key of ['description','version','icon','publisher'] as const)if(typeof row[key]==='string')item[key]=row[key];
       if(!item.description&&typeof row.summary==='string')item.description=row.summary;items.push(item);
      }
     }catch(e){errors.push(h.origin+(h.repo?' / '+h.repo:'')+': '+(e instanceof Error?e.message:'Search failed'));}
     results[i]={items,errors};
    }}));
    return {items:results.flatMap(r=>r.items).slice(0,limit),errors:results.flatMap(r=>r.errors)};
}
