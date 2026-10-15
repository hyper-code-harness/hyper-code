// Core widget: the published shared context agents (pinned chats live in the Chats widget).
export default {
    title: "Shared Agents",
    icon: "ph-brain",
    description: "Published shared context agents",
    sizes: ["tall", "L", "M"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const [shared, apps] = await Promise.all([
            ctx.fns.sharedAgent.list({}).catch(() => []),
            ctx.fns.nav.items({ includeAgents: false, limit: 500 }),
        ]);
        const sharedItems: types.nav.Item[] = shared.map(card => ({
            id: `shared:${card.agentId}`, label: card.name, href: `/agent/${encodeURIComponent(card.agentId)}`, icon: "ph-brain",
            detail: (card.capabilities ?? []).join(" · ") || card.description, hint: card.agentId,
        }));
        const declared = apps.filter(item => item.group === "Shared Agents").map(item => ({ ...item, pin: `page:${item.href}` }));
        return {
            items: [...declared, ...sharedItems],
        };
    },
} satisfies types.nav.Widget;
