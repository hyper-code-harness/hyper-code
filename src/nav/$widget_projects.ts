// Core widget: workspace folders of the recent chats, plus pages declared under "Projects & files".
export default {
    title: "Projects & files",
    icon: "ph-folder-open",
    description: "Workspace folders the chats work in",
    sizes: ["tall", "L", "M"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const [agents, apps] = await Promise.all([
            ctx.fns.nav.agents({ limit: 500 }).catch(() => [] as any[]),
            ctx.fns.nav.items({ includeAgents: false, limit: 500 }),
        ]);
        const folders = new Map<string, number>();
        for (const agent of agents as any[]) {
            const dir = String(agent.workspaceDir || "");
            if (!dir) continue;
            const key = agent.workspaceHost ? `${agent.workspaceHost}:${dir}` : dir;
            folders.set(key, (folders.get(key) ?? 0) + 1);
        }
        const items: types.nav.Item[] = [...folders].map(([dir, n]) => ({
            id: `folder:${dir}`, label: dir.split("/").filter(Boolean).pop() || dir, href: `/files?path=${encodeURIComponent(dir)}`,
            icon: "ph-folder-open", hint: `${n} ${n === 1 ? "agent" : "agents"}`,
        }));
        const declared = apps.filter(item => item.group === "Projects & files").map(item => ({ ...item, icon: item.icon || "ph-folder", pin: `page:${item.href}` }));
        return { items: [...items, ...declared] };
    },
} satisfies types.nav.Widget;
