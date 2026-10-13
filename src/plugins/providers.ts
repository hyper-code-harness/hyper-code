/**
 * Lists validated plugin providers declared by currently mounted runtime owners
 *
 * Use for provider discovery before search or materialization. Reconciles current boot declarations on every call, rejecting duplicate ids, malformed descriptors and handlers owned by another mounted root; no provider plugin is required.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<types.plugins.ProviderInfo[]> {
    const entries = ctx.state.procs.boot.entries as Array<{kind:string;name?:string;root:string;rootDir:string;abs:string;moduleDir:string;runtimeName?:string;fn?:unknown}>;
    const mounted = ctx.fns.procs.modules.list({}) as Array<{name:string;dir:string}>;
    const {resolve, relative, isAbsolute} = await import('node:path');
    const within = (base:string,path:string) => { const r=relative(resolve(base),resolve(path)); return r==='' || (r!=='..' && !r.startsWith('../') && !isAbsolute(r)); };
    const current = (e: typeof entries[number]) => within(e.rootDir,e.abs) && mounted.some(m => m.name === e.root && within(m.dir,e.rootDir));
    const result: types.plugins.ProviderInfo[] = [];
    const ids = new Set<string>();
    for (const e of entries.filter(e => e.kind === 'plugin' && e.name?.startsWith('provider_') && current(e))) {
     const id = e.name!.slice(9);
     if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid provider id: '+id);
     if (ids.has(id)) throw new Error('Duplicate provider: '+id);
     ids.add(id);
     const value = e.fn ?? (await import(e.abs + '?provider=' + Date.now())).default;
     const p = value as types.plugins.Provider;
     const text = (v:unknown, max:number) => typeof v === 'string' && v.length > 0 && v.length <= max;
     if (!p || typeof p !== 'object' || p.apiVersion !== 1 || !text(p.label,200) || !text(p.description,4000) || !p.handlers || typeof p.handlers !== 'object' || !text(p.handlers.search,200) || (p.handlers.materialize !== undefined && !text(p.handlers.materialize,200)) || (p.icon !== undefined && !text(p.icon,200)) || (p.configurationHref !== undefined && (!text(p.configurationHref,1000) || !/^\/(?!\/)/.test(p.configurationHref) || /[\\\\\u0000-\u0020]/.test(p.configurationHref) || new URL(p.configurationHref, 'https://provider.invalid').origin !== 'https://provider.invalid'))) throw new Error('Malformed provider: '+id);
     for (const key of Object.keys(p.handlers)) if (key !== 'search' && key !== 'materialize') throw new Error('Unknown provider handler: '+key);
     for (const handler of [p.handlers.search,p.handlers.materialize].filter((h):h is string=>h!==undefined)) {
      if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(handler) || handler.split('.').some(s=>['__proto__','prototype','constructor'].includes(s))) throw new Error('Invalid provider handler: '+handler);
      const candidates = entries.filter(f=>f.kind==='fn' && f.moduleDir.replaceAll('/','.')+'.'+f.runtimeName===handler && current(f));
      const active = candidates.at(-1);
      if (!active || active.root!==e.root || resolve(active.rootDir)!==resolve(e.rootDir)) throw new Error('Foreign or missing provider handler: '+handler);
      const live = handler.split('.').reduce((v:unknown,k)=>v && (v as Record<string,unknown>)[k], ctx.state.registry as unknown) as (((...args: never[]) => unknown) & {meta?:{abs?:string}}) | undefined;
      if (typeof live !== 'function' || (!live.meta?.abs || resolve(live.meta.abs)!==resolve(active.abs))) throw new Error('Stale provider handler: '+handler);
     }
     result.push({id,owner:e.root,apiVersion:1,label:p.label,description:p.description,...(p.icon?{icon:p.icon}:{}),...(p.configurationHref?{configurationHref:p.configurationHref}:{}),handlers:{...p.handlers}});
    }
    return result.sort((a,b)=>a.id.localeCompare(b.id));
}
