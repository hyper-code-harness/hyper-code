// Core search source: chats by title or id (ordered prefix and fuzzy matching, as nav.agents).
export default {
    title: "Chats",
    icon: "ph-chats-circle",
    order: 10,
    async search(ctx: Context, _session: Session | null, opts: { q: string; limit: number }): Promise<types.nav.Item[]> {
        return ctx.fns.nav.chatItems({ agents: await ctx.fns.nav.agents({ q: opts.q, limit: opts.limit }) });
    },
} satisfies types.nav.Search;
