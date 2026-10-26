/**
 * Draws the chat header as a w.paneHeader: a w.disclosure (chat icon · name · id · ⌄) that opens the chat panel,
 * then the badges and buttons on the right.
 *
 * The icon and the name belong to the core. Badges come from `$chatbadge_` files, buttons from `$chatbutton_`
 * files, the panel behind the disclosure from `$chatcard_` files, ordered and hidden by the chat.layout setting.
 * The panel content loads when it opens (GET /chat/:id/panel, chat/header.js), so its cards are always fresh and
 * never slow down the chat.
 * @param opts.context The chat being drawn (chat.buildRenderContext).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** The chat being drawn (chat.buildRenderContext). */
        context: types.chat.RenderContext;
    },
): Promise<string> {
    const w = ctx.fns.w;
    const { agent } = opts.context;
    const id = String(agent.id);
    const [badges, buttons] = await Promise.all([
        ctx.fns.chat.renderParts({ kind: "badge", context: opts.context }),
        ctx.fns.chat.renderParts({ kind: "button", context: opts.context }),
    ]);
    const title = String(agent.title ?? "").slice(0, 60) || id;
    const popover = `chat-panel-${id}`;
    const trigger = w.disclosure({
        label: title,
        meta: `(${id})`,
        popover,
        lead: w.chatIcon({ icon: agent.icon, model: agent.model, size: "sm", live: true }),
        attrs: { "data-chat-part": "icon", "aria-label": `Chat panel: ${title}` },
    });
    const panel = w.popover({
        id: popover,
        label: "Chat panel",
        width: 480,
        trigger,
        attrs: { "data-chat-panel": `/chat/${encodeURIComponent(id)}/panel` },
        body: `<div data-chat-panel-body>${w.spinner({ kind: "skeleton", lines: 4 })}</div>`,
    });
    return w.paneHeader({
        lead: panel,
        actions: `<span data-chat-badges>${badges.join("")}</span><span data-chat-buttons>${buttons.join("")}</span>`,
        attrs: { "data-chat-header": id },
    });
}
