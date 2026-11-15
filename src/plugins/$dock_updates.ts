// Plugin updates found by the daily check (plugins.checkUpdates), and the plugins the last Hyper update removed
// (plugins.dropped, computed once at start by plugins/$start.ts). Cached reads only — never git or the network on
// the render path. Hidden while there is nothing to say.
export default {
    label: "Plugin updates",
    zone: "bottom",
    order: 40,
    render: async (ctx: Context) => {
        const { updates } = await ctx.fns.plugins.pendingUpdates({});
        // Louder than an update: plugins the last Hyper update took away and nothing has brought back.
        const lost = ((ctx.state as { droppedPlugins?: { at: number; names: string[] } }).droppedPlugins?.names) ?? [];
        if (lost.length) return { icon: "ph-puzzle-piece", label: `Removed by the last Hyper update, install from the catalog: ${lost.slice(0, 6).join(", ")}${lost.length > 6 ? ` and ${lost.length - 6} more` : ""}`, href: "/plugins/listing", badge: "!" };
        if (!updates.length) return null;
        const names = updates.slice(0, 5).map(u => `${u.name} ${u.to}`).join(", ") + (updates.length > 5 ? ` and ${updates.length - 5} more` : "");
        return { icon: "ph-puzzle-piece", label: `Plugin update${updates.length === 1 ? "" : "s"}: ${names}`, href: "/plugins/listing", badge: updates.length };
    },
} satisfies types.dock.Item;
