/**
 * Validates and saves the local HyperHub configuration list
 *
 * Use after an explicit same-origin configuration submission. Rejects duplicate origins and secret-bearing URLs; performs no network access or activation.
 * @param opts.hubs Complete replacement list of at most eight hubs; empty list disables catalogue access.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Complete replacement list of at most eight hubs; empty list disables catalogue access. */
        hubs: Array<{ label: string; origin: string; enabled: boolean; repo?: string }>;
    },
): Promise<{ saved: true }> {
    if (!Array.isArray(opts.hubs)||opts.hubs.length>8) throw new Error('At most eight hubs are supported');
    const seen=new Set<string>(); const hubs=opts.hubs.map(p=>{ const raw=p.origin.trim(); let u:URL; try {u=new URL(raw);} catch {throw new Error('Use a credential-free HTTPS origin');} if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||raw.includes('?')||raw.includes('#')) throw new Error('Use a credential-free HTTPS origin'); if(seen.has(u.origin)) throw new Error('Duplicate hub origin'); seen.add(u.origin); if(typeof p.label!=='string'||p.label.length>80||typeof p.enabled!=='boolean'||(p.repo!==undefined&&(typeof p.repo!=='string'||p.repo.length>240))) throw new Error('Invalid hub fields'); return {label:p.label.trim()||u.host,origin:u.origin,enabled:p.enabled,...(p.repo?.trim()?{repo:p.repo.trim()}:{})}; });
    await ctx.fns.settings.set({module:'hyperhub',scopeType:'global',key:'hubs',value:JSON.stringify(hubs)}); return {saved:true};
}
