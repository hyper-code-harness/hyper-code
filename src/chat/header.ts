/**
 * Draws the chat header: icon (opens the chat panel) · name · badges … buttons.
 *
 * The icon (chat.icon; click opens the model picker) and the name (click renames) belong to the core.
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
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
    const { agent } = opts.context;
    const id = String(agent.id);
    const [badges, buttons] = await Promise.all([
        ctx.fns.chat.renderParts({ kind: "badge", context: opts.context }),
        ctx.fns.chat.renderParts({ kind: "button", context: opts.context }),
    ]);
    const title = String(agent.title ?? "").slice(0, 60) || id;
    const name = ctx.fns.ui.popup({
        method: "chat.renamePopup",
        params: { agentId: id },
        html: `${esc(title)} <span class="text-faint">(${esc(id)})</span>`,
        attrs: `class="min-w-0 truncate text-left font-mono font-medium leading-4 text-muted hover:text-base-content" title="Rename · ${esc(title)}" aria-label="Rename chat ${esc(title)}" data-chat-part="name"`,
    });
    // The chat's own icon opens the chat panel (the ⋯ dashboard: appearance, context, work, team, share, danger).
    // The model is chosen in the composer, so the icon no longer opens the model picker.
    const panel = await ctx.fns.ui.inplacePopup({
        id: `chat-panel-${id}`,
        triggerHtml: ctx.fns.chat.icon({ icon: agent.icon, model: agent.model, size: "md", live: true }),
        triggerAttrs: 'class="inline-flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-base-content/5 focus:outline-none focus:ring-2 focus:ring-primary/25" title="Chat panel" aria-label="Open chat panel" data-chat-part="icon"',
        panelAttrs: `aria-label="Chat panel" data-chat-panel="/chat/${encodeURIComponent(id)}/panel"`,
        contentHtml: '<div data-chat-panel-body class="p-3 text-xs text-faint">Loading…</div>',
    });
    return `<header class="chat-header glass-bar absolute inset-x-0 top-0 z-40 mx-auto mt-2 flex h-11 w-[calc(100%-2rem)] max-w-3xl shrink-0 items-center gap-2 overflow-visible rounded-[22px] border border-ui-border pl-2 pr-3 text-xs text-muted" data-chat-header="${esc(id)}">
  ${panel}
  <div class="flex min-w-0 shrink items-center gap-1.5">
    ${name}
    <div data-chat-badges class="flex min-w-0 items-center gap-1 overflow-hidden">${badges.join("")}</div>
  </div>
  <div class="ml-auto flex shrink-0 items-center gap-0.5" data-chat-buttons>${buttons.join("")}</div>
</header>`;
}
