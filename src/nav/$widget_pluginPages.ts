// Core widget: pages declared by plugins (`$app_` outside the core), grouped by their declared group,
// with a link to the plugin catalogue. Lives on the built-in Plugins tab.
export default {
    title: "Plugin pages",
    icon: "ph-plugs",
    description: "Pages that mounted plugins declare, by group",
    sizes: ["wide", "tall", "L"],
    async render(ctx: Context): Promise<types.nav.WidgetOutput> {
        const items = (await ctx.fns.nav.items({ includeAgents: false, limit: 500 }))
            .filter(item => item.plugin && !["Chats", "Shared Agents", "Projects & files"].includes(String(item.group)))
            .map(item => ({ ...item, icon: item.icon || "ph-plugs", pin: `page:${item.href}` }));
        const groups = new Map<string, types.nav.Item[]>();
        for (const item of items) {
            const group = item.group && !["System", "Pages", "Plugins"].includes(item.group) ? item.group : "Other";
            groups.set(group, [...(groups.get(group) ?? []), item]);
        }
        const names = [...groups.keys()].sort((a, b) => (a === "Other" ? 1 : 0) - (b === "Other" ? 1 : 0) || a.localeCompare(b));
        const catalogue = await ctx.fns.nav.rows({ items: [{ id: "plugins:catalogue", label: "All plugins", href: "/plugins", icon: "ph-squares-four", hint: "catalogue" }] });
        return {
            html: catalogue,
            columns: true,
            sections: names.map(name => ({ title: name, items: groups.get(name)! })),
        };
    },
} satisfies types.nav.Widget;
