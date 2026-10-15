// Search source for the global menu (⌘/): people, organizations, products and concepts in Knowledge.
// Type `@` first to search only here.
export default {
    title: "Knowledge",
    icon: "ph-graph",
    prefix: "@",
    order: 50,
    async search(ctx: Context, _session: Session | null, opts: { q: string; limit: number }): Promise<types.nav.Item[]> {
        if (opts.q.trim().length < 2) return [];
        const icons: Record<string, string> = { Person: "ph-user", Organization: "ph-buildings", Product: "ph-package", Concept: "ph-lightbulb" };
        const rows = await ctx.fns.knowledge.find({ query: opts.q, limit: opts.limit });
        return rows.map(row => ({
            id: `knowledge:${row.id}`,
            label: row.title || row.id,
            href: `/knowledge/${row.id.split("/").map(encodeURIComponent).join("/")}`,
            icon: icons[row.type] ?? "ph-node",
            hint: row.type,
            ...(row.summary ? { detail: row.summary } : {}),
        }));
    },
} satisfies types.nav.Search;
