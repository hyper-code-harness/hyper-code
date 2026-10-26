// Core widget: projects and their chats, master–detail. Left: every project with its chat count and unread dot,
// and "Misc" for chats that belong to no project. Right: the chosen project's chats and "New agent" in it.
// Every project's panel is drawn; the menu script (ui/navMenu.ts) shows the chosen one and remembers it.
export default {
    title: "Projects",
    icon: "ph-folders",
    description: "Projects and their chats (master–detail); chats without a project under Misc",
    sizes: ["tall", "wide", "L"],
    config: { limit: { type: "number", default: 30, description: "How many recent chats to list per project" } },
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
        const limit = Math.max(1, Math.min(100, Number(opts.config.limit ?? 30) || 30));
        const [projects, agents] = await Promise.all([
            ctx.fns.project.list({}),
            ctx.fns.nav.agents({ limit: 500 }).catch(() => [] as any[]),
        ]);
        // nav.agents cards carry no project; one query maps the shown chats to theirs.
        const ids = (agents as any[]).map(a => String(a.id));
        const owners: any[] = ids.length ? await ctx.fns.procs.db.select({ sql: `select id, project_id from agents where id in (${ids.map(() => "?").join(", ")}) and project_id is not null`, params: ids }) : [];
        const projectOf = new Map(owners.map(r => [String(r.id), String(r.project_id)]));
        const groups = [
            ...projects.map(p => ({ id: p.id, title: p.title, newHref: `/agent/new?project=${encodeURIComponent(p.id)}`, chats: [] as any[] })),
            { id: "", title: "Misc", newHref: "/agent/new?project=", chats: [] as any[] },
        ];
        const byId = new Map(groups.map(g => [g.id, g]));
        for (const agent of agents as any[]) (byId.get(projectOf.get(String(agent.id)) ?? "") ?? byId.get("")!).chats.push(agent);
        const shown = groups.filter(g => g.id || g.chats.length);
        const key = (g: { id: string }) => g.id || "misc";
        const master = await ctx.fns.nav.rows({ items: [{ id: "project:new", label: "New project", href: "/project/new", icon: "ph-plus", action: true }] }) + shown.map(g => {
            const unread = g.chats.some(a => a.hasUnread);
            const running = g.chats.some(a => a.runState && a.runState !== "idle");
            // A project row is a button, not a link: ↵ / → shows its chats in the right column (the menu script).
            return ctx.fns.w.listRow({
                label: g.title,
                icon: g.id ? "folder" : "tray",
                hint: String(g.chats.length),
                dot: running ? "running" : unread ? "unread" : undefined,
                action: { action: "nav-project" },
                attrs: { "data-nav-row": true, "data-nav-project-pick": key(g), "data-nav-id": `project:${key(g)}` },
            });
        }).join("");
        const panels = await Promise.all(shown.map(async (g, i) => {
            const rows = await ctx.fns.nav.rows({ items: [
                { id: `project:${key(g)}:new`, label: g.id ? `New agent in ${g.title}` : "New agent", href: g.newHref, icon: "ph-plus", action: true },
                ...await ctx.fns.nav.chatItems({ agents: g.chats.slice(0, limit) }),
            ] });
            const more = g.chats.length > limit ? ctx.fns.w.listRow({ label: `${g.chats.length - limit} more — search ⌘/`, icon: "dots-three" }) : "";
            return `<div data-nav-project-panel="${esc(key(g))}"${i ? " hidden" : ""}>${rows}${more}</div>`;
        }));
        return { html: ctx.fns.w.masterDetail({ master, detail: panels.join(""), attrs: { "data-nav-projects": true } }) };
    },
} satisfies types.nav.Widget;
