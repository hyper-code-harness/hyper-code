/**
 * Renders the unread @mentions badge of the left navigation rail.
 *
 * An @ button with the viewer's unread count that opens a popup listing those mentions (who, which chat,
 * a line of text) with links straight to the message. Hidden when there is nothing unread. Refreshed by
 * GET /mentions/badge when a `mentions.changed` event arrives.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<string> {
    const me = await ctx.fns.auth.viewerId({});
    if (!me) return "";
    // data-me tells the live script whose mention events concern this tab.
    const meAttr = ` data-me="${ctx.fns.procs.ui.escape({ text: me })}"`;
    const count = await ctx.fns.mentions.unreadCount({ userId: me });
    if (!count) return `<div id="mentions-badge"${meAttr} hidden></div>`;
    const items = await ctx.fns.mentions.list({ userId: me, unreadOnly: true, limit: 20 });
    const rows = await ctx.fns.mentions.rowsHtml({ items });
    const label = `${count} unread mention${count === 1 ? "" : "s"}`;
    return `<div id="mentions-badge"${meAttr} class="mt-1">` + await ctx.fns.ui.inplacePopup({
        id: "mentions-popup",
        triggerHtml: `<span class="flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-content"><span aria-hidden="true">@</span>${count}</span>`,
        triggerAttrs: `class="flex items-center justify-center" title="${label}" aria-label="${label}"`,
        panelAttrs: `aria-label="Mentions" data-placement="side"`,
        contentHtml: `<div class="w-80 max-w-[80vw]"><div class="mb-1 border-b border-ui-border px-2 pb-1.5 text-xs font-semibold">Mentions</div><div class="max-h-[60vh] overflow-y-auto">${rows}</div></div>`,
    }) + '</div>';
}
