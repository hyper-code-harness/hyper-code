// Core widget: the viewer's pinned chats and the published shared context agents.
export default {
    title: "Shared Agents",
    icon: "ph-brain",
    description: "Pinned chats and published shared context agents",
    sizes: ["tall", "L", "M"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const [pinnedIds, shared, apps] = await Promise.all([
            ctx.fns.auth.pinnedIds({}).catch(() => new Set<string>()),
            ctx.fns.sharedAgent.list({}).catch(() => []),
            ctx.fns.nav.items({ includeAgents: false, limit: 500 }),
        ]);
        const pinnedAgents = pinnedIds.size ? (await ctx.fns.nav.agents({ limit: 500 }).catch(() => [] as any[])).filter((a: any) => pinnedIds.has(String(a.id))) : [];
        const sharedItems: types.nav.Item[] = shared.map(card => ({
            id: `shared:${card.agentId}`, label: card.name, href: `/agent/${encodeURIComponent(card.agentId)}`, icon: "ph-brain",
            detail: (card.capabilities ?? []).join(" · ") || card.description, hint: card.agentId,
        }));
        const declared = apps.filter(item => item.group === "Shared Agents").map(item => ({ ...item, pin: `page:${item.href}` }));
        return {
            sections: [
                ...(pinnedAgents.length ? [{ title: "Pinned", items: await ctx.fns.nav.chatItems({ agents: pinnedAgents }), tone: "warning" as const }] : []),
                { title: "", items: [...declared, ...sharedItems] },
            ],
        };
    },
} satisfies types.nav.Widget;
