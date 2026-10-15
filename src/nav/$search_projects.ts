// Core search source: workspace folders the chats work in, by folder name or path.
export default {
    title: "Projects & files",
    icon: "ph-folder-open",
    order: 40,
    async search(ctx: Context, _session: Session | null, opts: { q: string; limit: number }): Promise<types.nav.Item[]> {
        const q = opts.q.toLowerCase();
        const folders = new Map<string, number>();
        for (const agent of await ctx.fns.nav.agents({ limit: 500 }) as any[]) {
            const dir = String(agent.workspaceDir || "");
            if (!dir) continue;
            const key = agent.workspaceHost ? `${agent.workspaceHost}:${dir}` : dir;
            folders.set(key, (folders.get(key) ?? 0) + 1);
        }
        return [...folders].filter(([dir]) => dir.toLowerCase().includes(q)).slice(0, opts.limit).map(([dir, n]) => ({
            id: `folder:${dir}`, label: dir.split("/").filter(Boolean).pop() || dir, href: `/files?path=${encodeURIComponent(dir)}`,
            icon: "ph-folder-open", hint: `${n} ${n === 1 ? "agent" : "agents"}`, detail: dir,
        }));
    },
} satisfies types.nav.Search;
