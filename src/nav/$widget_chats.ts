// Core widget: New agent, the viewer's unread @mentions, pinned chats and recent chats — the first column of the menu.
// A chat in a project shows the project's title in grey at the right of its row.
export default {
    title: "Chats",
    icon: "ph-chats-circle",
    description: "New agent, unread mentions, pinned chats and the most recent chats",
    sizes: ["tall", "L", "M"],
    config: { limit: { type: "number", default: 50, description: "How many recent chats to list" } },
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const limit = Math.max(1, Math.min(200, Number(opts.config.limit ?? 50) || 50));
        const [agents, mentions, pinnedIds] = await Promise.all([
            ctx.fns.nav.agents({ limit }).catch(() => [] as any[]),
            ctx.fns.mentions.list({ unreadOnly: true, limit: 10 }).catch(() => []),
            ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
        ]);
        const pinnedAgents = pinnedIds.size ? (await ctx.fns.nav.agents({ limit: 500 }).catch(() => [] as any[])).filter((a: any) => pinnedIds.has(String(a.id))) : [];
        // Each chat shows its project quietly at the right (the row's grey hint); chats without one show nothing.
        const ids = [...new Set([...agents, ...pinnedAgents].map((a: any) => String(a.id)))];
        const [projects, owners] = await Promise.all([
            ctx.fns.project.list({}).catch(() => [] as any[]),
            ids.length ? ctx.fns.procs.db.select({ sql: `select id, project_id from agents where id in (${ids.map(() => "?").join(", ")}) and project_id is not null`, params: ids }).catch(() => [] as any[]) : [],
        ]);
        const titles = new Map(projects.map((p: any) => [String(p.id), String(p.title || p.slug)]));
        const projectOf = new Map((owners as any[]).map(r => [`agent:${r.id}`, titles.get(String(r.project_id))]));
        const withProject = (items: types.nav.Item[]) => items.map(item => { const hint = projectOf.get(String(item.id)); return hint ? { ...item, hint } : item; });
        const chatItems = withProject(await ctx.fns.nav.chatItems({ agents }));
        const mentionsHtml = mentions.length ? await ctx.fns.mentions.rowsHtml({ items: mentions, navRow: true }) : "";
        return {
            items: [{ id: "chats:new", label: "New agent", href: "/agent/new", icon: "ph-plus", action: true }, ...await ctx.fns.nav.newAgentActionItems({ prefix: "chats" })],
            sections: [
                ...(mentions.length ? [{ title: `Mentions · ${mentions.length}`, html: mentionsHtml, tone: "primary" as const }] : []),
                ...(pinnedAgents.length ? [{ title: "Pinned", items: withProject(await ctx.fns.nav.chatItems({ agents: pinnedAgents })), tone: "warning" as const }] : []),
                { title: "", items: chatItems },
            ],
        };
    },
} satisfies types.nav.Widget;
