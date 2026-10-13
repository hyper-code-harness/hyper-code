/**
 * Reads saved HyperHub origins with legacy registry preference fallback
 *
 * Use to obtain up to eight configured credential-free HTTPS hubs without contacting any remote server. An explicitly saved empty list suppresses legacy fallback.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Array<{ label: string; origin: string; enabled: boolean; repo?: string }>> {
    const raw = await ctx.fns.settings.get({module:'hyperhub',scopeType:'global',key:'hubs'});
    const valid = (s:string) => { try { const u=new URL(s); return u.protocol==='https:' && !u.username && !u.password && u.pathname==='/' && !s.includes('?') && !s.includes('#'); } catch { return false; } };
    if (typeof raw==='string' && raw) { const rows=JSON.parse(raw); if (!Array.isArray(rows)) throw new Error('Invalid saved hub list'); return rows.slice(0,8).filter(p=>p && typeof p.origin==='string' && valid(p.origin)).map(p=>({label:String(p.label||new URL(p.origin).host).slice(0,80),origin:new URL(p.origin).origin,enabled:p.enabled===true,...(typeof p.repo==='string'&&p.repo?{repo:p.repo.slice(0,240)}:{})})); }
    const legacy=await ctx.fns.settings.get({module:'hyperhub',scopeType:'global',key:'registryUrl'});
    return typeof legacy==='string' && valid(legacy) ? [{label:new URL(legacy).host,origin:new URL(legacy).origin,enabled:true}] : [];
}
