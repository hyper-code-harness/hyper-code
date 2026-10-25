// Settings gear at the bottom of the Dock: a popover with the color theme switch and the Hyper update status
// (both used to be separate Dock entries). The theme button keeps id="theme-toggle" so /dock/dock.js flips and
// paints it; the update region reuses ui.updateBadge's lazy /update/status poll in its row form. When an
// update is available or blocked, the gear shows a small dot (painted by /dock/dock.js from the row).
export default {
    label: "Settings",
    zone: "bottom",
    order: 5,
    render: async (ctx: Context) => {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
        const row = "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-base-content hover:bg-base-200";
        const theme = ctx.fns.procs.ui.button({
            action: "toggle-theme",
            html: '<i class="ph ph-moon text-base text-subtle" aria-hidden="true"></i><span class="min-w-0 flex-1 truncate">Theme</span><span class="shrink-0 text-xs text-faint" data-theme-name>Light</span>',
            appearance: "plain",
            title: "",
            ariaLabel: "Switch color theme",
            class: row,
            attrs: { id: "theme-toggle", "aria-pressed": "false" },
        });
        const update = `<div class="${row} cursor-default hover:bg-transparent" data-dock-update-row><i class="ph ph-arrows-clockwise text-base text-subtle" aria-hidden="true"></i><span class="min-w-0 flex-1 truncate">Hyper update</span>${await ctx.fns.ui.updateBadge({})}</div>`;
        const links = [["ph-gear-six", "All settings", "/settings"], ["ph-plugs-connected", "LLM connections", "/llms"]]
            .map(([icon, label, href]) => `<a href="${esc(href)}" class="${row}"><i class="ph ${icon} text-base text-subtle" aria-hidden="true"></i><span class="flex-1">${esc(label)}</span></a>`).join("");
        return `<div class="mb-1 flex w-full justify-center">` + await ctx.fns.ui.inplacePopup({
            id: "dock-settings-popup",
            triggerHtml: '<i class="ph ph-gear-six text-base" aria-hidden="true"></i><span data-dock-settings-dot hidden class="pointer-events-none absolute right-0.5 top-0.5 size-2 rounded-full bg-info"></span>',
            triggerAttrs: `class="relative flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content" title="Settings" aria-label="Settings"`,
            panelAttrs: `aria-label="Settings" data-placement="side" data-dock-settings-panel`,
            contentHtml: `<div class="w-full min-w-0">${theme}${update}<div class="my-1 border-t border-ui-border"></div>${links}</div>`,
        }) + `</div>`;
    },
} satisfies types.dock.Item;
