// Core widget: the pages the core declares (`$app_`); System pages other than Search fold into
// "Administration". Pages declared by plugins are on the Plugins tab (plugin-pages widget).
export default {
    title: "Pages",
    icon: "ph-browsers",
    description: "Pages of the core, administration folded",
    sizes: ["tall", "L", "M", "wide"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const items = (await ctx.fns.nav.items({ includeAgents: false, limit: 500 }))
            .filter(item => !item.plugin && !["Chats", "Shared Agents", "Projects & files"].includes(String(item.group)))
            .map(item => ({ ...item, icon: item.icon || "ph-gear", pin: `page:${item.href}` }));
        const isAdmin = (item: types.nav.Item) => (item.group ?? "System") === "System" && item.href !== "/search";
        const admin = items.filter(isAdmin);
        return {
            items: items.filter(item => !isAdmin(item)),
            sections: admin.length ? [{ title: "Administration", items: admin, collapsed: true, count: admin.length }] : [],
        };
    },
} satisfies types.nav.Widget;
