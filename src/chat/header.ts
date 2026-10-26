/**
 * Draws the chat header: icon (opens the chat panel) · name · badges … buttons.
 *
 * The icon (w.chatIcon; click opens the model picker) and the name (click renames) belong to the core.
 * Badges come from `$chatbadge_` files, buttons from `$chatbutton_` files, the panel behind the icon from `$chatcard_`
 * files, ordered and hidden by the chat.layout setting. The panel content loads when it opens
 * (GET /chat/:id/panel), so its cards are always fresh and never slow down the chat.
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
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const { agent } = opts.context;
    const id = String(agent.id);
    const [badges, buttons] = await Promise.all([
        ctx.fns.chat.renderParts({ kind: "badge", context: opts.context }),
        ctx.fns.chat.renderParts({ kind: "button", context: opts.context }),
    ]);
    const title = String(agent.title ?? "").slice(0, 60) || id;
    // Icon + name + ⌄ are one button that opens the chat panel (appearance with Rename…, context, work, team,
    // share, danger). The chevron says "this opens"; hover is a grey backing on the whole group; open is blue.
    // The model is chosen in the composer.
    const panel = await ctx.fns.ui.inplacePopup({
        id: `chat-panel-${id}`,
        triggerHtml: `${ctx.fns.w.chatIcon({ icon: agent.icon, model: agent.model, size: "sm", live: true })}<span class="chat-head-title" data-chat-part="name">${esc(title)}</span><span class="chat-head-id">(${esc(id)})</span><i class="ph ph-caret-down chat-head-caret" aria-hidden="true"></i>`,
        triggerAttrs: `class="chat-head-trigger" title="Chat panel" aria-label="Chat panel: ${esc(title)}" data-chat-part="icon"`,
        panelAttrs: `aria-label="Chat panel" data-chat-panel="/chat/${encodeURIComponent(id)}/panel"`,
        contentHtml: '<div data-chat-panel-body class="p-3 text-xs text-faint">Loading…</div>',
    });
    return `<header class="chat-header glass-bar absolute inset-x-0 top-0 z-40 mx-auto mt-2 flex h-11 w-[calc(100%-2rem)] max-w-3xl shrink-0 items-center gap-2 overflow-visible rounded-[22px] border border-ui-border pl-2 pr-3 text-xs text-muted" data-chat-header="${esc(id)}">
  ${panel}
  <div class="flex min-w-0 shrink items-center gap-1.5">
    <div data-chat-badges class="flex min-w-0 items-center gap-1 overflow-hidden">${badges.join("")}</div>
  </div>
  <div class="ml-auto flex shrink-0 items-center gap-0.5" data-chat-buttons>${buttons.join("")}</div>
</header>`;
}
