// Core widget: the pages the core declares (`$app_`). Which pages and in what order comes from the setting
// nav.pages (ids of $app_ files, usually fixed for the instance in ~/.hyper/settings/$settings_nav.json); without
// it every core page shows by its declared order, System pages other than Search in an "Administration" section.
// Pages declared by plugins are on the Plugins tab (plugin-pages widget).
export default {
    title: "Pages",
    icon: "ph-browsers",
    description: "Pages of the core; which and in what order is the nav.pages setting",
    sizes: ["tall", "L", "M", "wide"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const all = (await ctx.fns.nav.items({ includeAgents: false, limit: 500 }))
            .filter(item => !["Chats", "Shared Agents", "Projects & files"].includes(String(item.group)))
            .map(item => ({ ...item, icon: item.icon || "ph-gear", pin: `page:${item.href}` }));
        const chosen = await ctx.fns.settings.get({ module: "nav", scopeType: "global", key: "pages" });
        if (Array.isArray(chosen)) {
            const byId = new Map(all.map(item => [String(item.id ?? "").replace(/^app:/, ""), item]));
            return { items: chosen.map(id => byId.get(String(id))).filter((item): item is NonNullable<typeof item> => !!item) };
        }
        const items = all.filter(item => !item.plugin);
        const isAdmin = (item: types.nav.Item) => (item.group ?? "System") === "System" && item.href !== "/search";
        const admin = items.filter(isAdmin);
        return {
            items: items.filter(item => !isAdmin(item)),
            sections: admin.length ? [{ title: "Administration", items: admin, count: admin.length }] : [],
        };
    },
} satisfies types.nav.Widget;
