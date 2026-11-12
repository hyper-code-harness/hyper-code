// Plugin updates found by the daily check (plugins.checkUpdates). A cached read of two small files — never the
// network on the render path. Hidden while there is nothing to update.
export default {
    label: "Plugin updates",
    zone: "bottom",
    order: 40,
    render: async (ctx: Context) => {
        const { updates } = await ctx.fns.plugins.pendingUpdates({});
        if (!updates.length) return null;
        const names = updates.slice(0, 5).map(u => `${u.name} ${u.to}`).join(", ") + (updates.length > 5 ? ` and ${updates.length - 5} more` : "");
        return { icon: "ph-puzzle-piece", label: `Plugin update${updates.length === 1 ? "" : "s"}: ${names}`, href: "/plugins/listing", badge: updates.length };
    },
} satisfies types.dock.Item;
