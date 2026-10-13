/**
 * Dispatches bounded plugin search or inert materialization to a validated mounted provider
 *
 * Use only provider identifiers, never a caller-supplied function name. Checks descriptor ownership on every call, validates opaque selections and ensures materialization uses the empty core staging directory without activating code.
 * @param opts.provider Identifier from plugins.providers.
 * @param opts.operation Discovery or inert staging operation.
 * @param opts.args Operation-specific search filters or pinned selection and core staging directory.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Identifier from plugins.providers. */
        provider: string;
        /** Discovery or inert staging operation. */
        operation: "search" | "materialize";
        /** Operation-specific search filters or pinned selection and core staging directory. */
        args: types.plugins.ProviderSearchOpts | types.plugins.ProviderMaterializeOpts;
    },
): Promise<types.plugins.ProviderSearchResult | { path: string }> {
    const provider = (await ctx.fns.plugins.providers({})).find(p=>p.id===opts.provider);
    if (!provider) throw new Error('Missing plugin provider: '+opts.provider);
    if (opts.operation !== 'search' && opts.operation !== 'materialize') throw new Error('Unsupported provider operation');
    const object = (v:unknown): v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
    const bounded = (v:unknown,max:number) => typeof v==='string' && v.length>0 && v.length<=max && !v.includes('\0');
    const selection = (v:unknown): v is types.plugins.ProviderSelection => {
     if(!object(v) || Object.keys(v).some(k=>!['provider','name','revision','source'].includes(k)) || v.provider!==provider.id || !bounded(v.name,200) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(String(v.name)) || !bounded(v.revision,512) || !object(v.source)) return false;
     const parts=Object.entries(v.source);
     return parts.length<=32 && parts.every(([k,value])=>bounded(k,100) && !['__proto__','prototype','constructor'].includes(k) && typeof value==='string' && value.length<=4096 && !value.includes('\0')) && JSON.stringify(v.source).length<=16384;
    };
    if(!object(opts.args)) throw new Error('Invalid provider arguments');
    const name=provider.handlers[opts.operation];
    if(!name) throw new Error('Provider does not support '+opts.operation);
    const handler=name.split('.').reduce((v:unknown,k)=>(v as Record<string,unknown>)[k],ctx.fns as unknown) as (args:types.plugins.ProviderSearchOpts | types.plugins.ProviderMaterializeOpts)=>Promise<unknown>;
    if(opts.operation==='search') {
     const args=opts.args as types.plugins.ProviderSearchOpts;
     if(Object.keys(args).some(k=>!['q','limit'].includes(k)) || (args.q!==undefined && (typeof args.q!=='string' || args.q.length>2000)) || (args.limit!==undefined && (!Number.isInteger(args.limit) || args.limit<1 || args.limit>100))) throw new Error('Invalid provider search arguments');
     const limit=args.limit??30;
     const result=await handler({q:args.q,limit});
     if(!object(result) || !Array.isArray(result.items) || result.items.length>limit || !Array.isArray(result.errors) || result.errors.length>100 || result.errors.some(e=>typeof e!=='string'||e.length>4000)) throw new Error('Malformed provider search result');
     for(const item of result.items) {
      if(!object(item) || !selection(item.selection) || Object.keys(item).some(k=>!['selection','label','description','version','icon','publisher'].includes(k)) || ['label','description','version','icon','publisher'].some(k=>item[k]!==undefined && !bounded(item[k],4000))) throw new Error('Malformed provider item');
     }
     return result as types.plugins.ProviderSearchResult;
    }
    const args=opts.args as types.plugins.ProviderMaterializeOpts;
    if(Object.keys(args).some(k=>!['selection','destination'].includes(k)) || !selection(args.selection) || !bounded(args.destination,4096)) throw new Error('Invalid provider materialization arguments');
    const {isAbsolute,resolve}=await import('node:path');
    const {lstat,readdir,realpath}=await import('node:fs/promises');
    if(!isAbsolute(args.destination)) throw new Error('Staging destination must be absolute');
    const before=await lstat(args.destination);
    if(!before.isDirectory() || before.isSymbolicLink() || (await readdir(args.destination)).length || await realpath(args.destination)!==resolve(args.destination)) throw new Error('Staging destination must be an empty real directory');
    const result=await handler({selection:structuredClone(args.selection),destination:args.destination});
    const after=await lstat(args.destination);
    if(!object(result) || typeof result.path!=='string' || resolve(result.path)!==resolve(args.destination) || !after.isDirectory() || after.isSymbolicLink() || before.ino!==after.ino || before.dev!==after.dev) throw new Error('Provider escaped staging destination');
    return {path:args.destination};
}
