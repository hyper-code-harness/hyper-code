// Core widget: the latest chats grouped by their project — projects ordered by their newest chat, chats without a
// project last under "No project". The default content of the side panel beside the Dock (dock.panel) and also
// placeable on any tab of the global menu (⌘/).
export default {
    title: "Recent by project",
    icon: "ph-clock-counter-clockwise",
    description: "The latest chats grouped by project, newest first",
    sizes: ["tall", "L", "M"],
    config: { limit: { type: "number", default: 20, description: "How many recent chats to show across all projects" } },
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const limit = Math.max(1, Math.min(200, Number(opts.config.limit ?? 20) || 20));
        const [agents, projects] = await Promise.all([
            ctx.fns.nav.agents({ limit }).catch(() => [] as any[]),
            ctx.fns.project.list({}).catch(() => [] as any[]),
        ]);
        // nav.agents cards carry no project; one query maps the shown chats to theirs.
        const ids = agents.map((a: any) => String(a.id));
        const owners: any[] = ids.length
            ? await ctx.fns.procs.db.select({ sql: `select id, project_id from agents where id in (${ids.map(() => "?").join(", ")}) and project_id is not null`, params: ids }).catch(() => []) as any[]
            : [];
        const projectOf = new Map(owners.map(r => [String(r.id), String(r.project_id)]));
        const titles = new Map(projects.map((p: any) => [String(p.id), String(p.title || p.slug)]));
        const groups = new Map<string, any[]>();
        for (const a of agents) {
            const key = projectOf.get(String(a.id)) ?? "";
            const list = groups.get(key) ?? [];
            list.push(a);
            groups.set(key, list);
        }
        const order = [...groups.keys()].filter(k => k).concat(groups.has("") ? [""] : []);
        const sections = await Promise.all(order.map(async key => ({
            title: key ? titles.get(key) ?? key : "No project",
            items: await ctx.fns.nav.chatItems({ agents: groups.get(key)! }),
        })));
        return {
            items: [{ id: "recent:new", label: "New agent", href: "/agent/new", icon: "ph-plus", action: true }],
            sections,
        };
    },
} satisfies types.nav.Widget;
