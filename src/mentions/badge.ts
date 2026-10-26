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
    const meAttr = ` data-me="${ctx.fns.w.escape({ text: me })}"`;
    const count = await ctx.fns.mentions.unreadCount({ userId: me });
    if (!count) return `<div id="mentions-badge"${meAttr} hidden></div>`;
    const items = await ctx.fns.mentions.list({ userId: me, unreadOnly: true, limit: 20 });
    const rows = await ctx.fns.mentions.rowsHtml({ items });
    const label = `${count} unread mention${count === 1 ? "" : "s"}`;
    const w = ctx.fns.w;
    const body = w.listSection({ title: "Mentions", rows: rows });
    return `<div id="mentions-badge"${meAttr}>` + w.popover({ id: "mentions-popup", label: "Mentions", placement: "side", width: 320, body,
        trigger: w.railItem({ label, icon: "at", badge: count, action: { popover: "mentions-popup" } }) }) + "</div>";
}
