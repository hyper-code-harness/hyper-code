// Global navigation contains app pages and chats, not mounted plugin records.
/**
 * Lists explicitly declared apps and optional agent chats; HTTP routes alone never create menu entries.
 * @param opts.q Optional case-insensitive filter applied to labels, URLs, and hints.
 * @param opts.limit Maximum number of navigation items to return.
 * @param opts.includeAgents Whether to include agent chat destinations; disable when the caller loads scoped agent rows separately.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { q?: string; limit?: number; includeAgents?: boolean },
): Promise<types.nav.Item[]> {
    const q = (opts.q ?? "").trim().toLowerCase();
    const limit = opts.limit ?? 20;

    const apps: types.nav.Item[] = Object.values((ctx.state as any).nav?.apps ?? {})
        .sort((a: any, b: any) => Number(a.order) - Number(b.order) || String(a.label).localeCompare(String(b.label)))
        .map((app: any): types.nav.Item => ({
            label: String(app.label), href: String(app.href), hint: String(app.hint ?? "page"),
            icon: String(app.icon ?? "ph-gear"), group: String(app.group ?? "System"), order: Number(app.order ?? 100),
            ...(app.plugin ? { plugin: true } : {}),
            id: `app:${app.name}`,
        }));


    const agents = opts.includeAgents === false ? [] : (await ctx.fns.nav.agents({ q, limit })).map((agent: any): types.nav.Item => ({
        label: `${agent.id} · ${String(agent.title ?? "").slice(0, 60)}`,
        href: `/agent/${encodeURIComponent(agent.id)}`,
        hint: `agent · ${agent.model} · ${agent.turns} turns`,
        group: "Chats",
    }));

    const all = [...apps, ...agents].filter(item =>
        !item.href.startsWith('/plugins?') && !item.href.startsWith('/plugins/') &&
        item.href !== '/procs/modules' &&
        item.href !== '/hyperhub' && !item.href.startsWith('/hyperhub/'));
    const hit = (item: types.nav.Item) => !q || item.label.toLowerCase().includes(q) || item.href.toLowerCase().includes(q) || (item.hint ?? "").toLowerCase().includes(q);
    return all.filter(hit).slice(0, limit);
}
