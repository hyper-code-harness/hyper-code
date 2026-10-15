// Core search source: pages declared by `$app_` files, by label, URL or hint.
export default {
    title: "Pages",
    icon: "ph-browsers",
    prefix: "/",
    order: 30,
    async search(ctx: Context, _session: Session | null, opts: { q: string; limit: number }): Promise<types.nav.Item[]> {
        return (await ctx.fns.nav.items({ q: opts.q, limit: opts.limit, includeAgents: false }))
            .map(item => ({ ...item, id: `page:${item.href}`, icon: item.icon || "ph-gear", pin: `page:${item.href}` }));
    },
} satisfies types.nav.Search;
