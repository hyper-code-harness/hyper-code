// Widget for the global menu (⌘/): unread received inbox mail of this Hyper's agents.
export default {
    title: "Inbox",
    icon: "ph-envelope-simple",
    description: "Unread encrypted mail received by this Hyper's agents",
    sizes: ["S", "M", "tall"],
    ttl: 30,
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size }): Promise<types.nav.WidgetOutput> {
        const mail = (await ctx.fns.inbox.list({ direction: "in", limit: 100 })).filter(m => !m.readAt);
        const max = opts.size === "S" ? 2 : opts.size === "tall" ? 20 : 5;
        const count = `<a href="/inbox" class="nav-row mb-1 flex items-baseline gap-2 rounded px-2 py-1 outline-none hover:bg-base-200/60"><span class="text-2xl font-semibold tabular-nums">${mail.length}</span><span class="text-xs text-faint">unread</span></a>`;
        return {
            html: count,
            items: mail.slice(0, max).map(m => ({
                id: `inbox:${m.id}`,
                label: m.subject || m.text.slice(0, 80) || "(empty)",
                href: `/inbox/${encodeURIComponent(m.id)}`,
                icon: m.verified ? "ph-envelope" : "ph-warning",
                hint: m.from.split("@")[0],
            })),
        };
    },
} satisfies types.nav.Widget;
