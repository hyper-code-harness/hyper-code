/**
 * Draws the plugin quick actions for the New agent form as one row of buttons.
 *
 * Takes items from ui.newAgentActions; an href item is a link, an fn item opens that runtime function in the app popup. Returns "" for an empty list, so a page with no answers is unchanged.
 * @param opts.items Quick actions from ui.newAgentActions.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Quick actions from ui.newAgentActions. */
        items: types.ui.NewAgentAction[];
    },
): string {
    if (!opts.items?.length) return "";
    const buttons = opts.items.map(item => ctx.fns.w.button({
        label: item.label,
        icon: item.icon ? item.icon.slice(3) : "plus",
        tone: "neutral",
        size: "sm",
        action: item.href ? { href: item.href } : { popup: { method: String(item.fn) } },
        marks: { action: "new-agent-quick", id: item.id },
    })).join("");
    return `<div class="flex flex-wrap gap-2" data-new-agent-actions>${buttons}</div>`;
}
