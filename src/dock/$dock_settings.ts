// Settings gear at the bottom of the Dock: a popover with the color theme switch and the Hyper update status
// (both used to be separate Dock entries). Theme controls use /ui/theme.js; the update region reuses
// ui.updateBadge's lazy /update/status poll in its row form. When an
// update is available or blocked, the gear shows a small dot (painted by /dock/dock.js from the row).
export default {
    label: "Settings",
    zone: "bottom",
    order: 5,
    render: async (ctx: Context) => {
        const w = ctx.fns.w;
        // Keep an explicit return to the system preference, not a hidden three-way cycle.
        const theme = w.listRow({ label: "Theme", icon: "moon", hint: "Light", action: { action: "toggle-theme" }, attrs: { id: "theme-toggle", "aria-pressed": "false", "data-theme-row": true } });
        const automatic = w.listRow({ label: "Use system theme", icon: "desktop", hint: "On", action: { action: "system-theme" }, attrs: { id: "theme-system", "aria-pressed": "true" } });
        const update = w.listRow({ label: "Hyper update", icon: "arrows-clockwise", attrs: { "data-dock-update-row": true } });
        const links = w.listRow({ label: "All settings", icon: "gear-six", action: { href: "/settings" } }) + w.listRow({ label: "LLM connections", icon: "plugs-connected", action: { href: "/llms" } });
        const body = w.list({ body: theme + automatic + `<div class="dock-update-row">${update}${await ctx.fns.ui.updateBadge({})}</div>` + w.divider({}) + links });
        // The gear carries a dot while an update is waiting (painted by /dock/dock.js from the badge in the panel).
        const gear = w.railItem({ label: "Settings", face: `${w.icon({ name: "gear-six" })}<span class="w-dot" data-state="unread" data-dock-settings-dot hidden></span>`, action: { popover: "dock-settings-popup" } });
        return w.popover({ id: "dock-settings-popup", label: "Settings", placement: "side", width: 240, body, trigger: gear });
    },
} satisfies types.dock.Item;
