// Core search source: published shared context agents by name, description or capability.
export default {
    title: "Shared Agents",
    icon: "ph-brain",
    order: 20,
    async search(ctx: Context, _session: Session | null, opts: { q: string; limit: number }): Promise<types.nav.Item[]> {
        return (await ctx.fns.sharedAgent.list({ query: opts.q })).slice(0, opts.limit).map(card => ({
            id: `shared:${card.agentId}`, label: card.name, href: `/agent/${encodeURIComponent(card.agentId)}`, icon: "ph-brain",
            detail: (card.capabilities ?? []).join(" · ") || card.description, hint: card.agentId,
        }));
    },
} satisfies types.nav.Search;
