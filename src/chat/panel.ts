/**
 * Draws the ⋯ chat panel: a small dashboard of `$chatcard_` cards about one chat, in a two-column grid.
 *
 * Cards render in parallel, each under 1.5 s; a throw, a timeout or null leaves the card out. Order and hiding
 * follow the chat.layout setting; the core danger card (Archive, Delete) is always last. Served by
 * GET /chat/:id/panel when the panel opens.
 * @param opts.agentId Agent whose chat panel is drawn.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose chat panel is drawn. */
        agentId: string;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
    const view = await ctx.fns.chat.buildRenderContext({ agentId: opts.agentId });
    if (!view) return `<div class="p-3 text-xs text-faint">chat ${esc(opts.agentId)} not found</div>`;
    const cards = await ctx.fns.chat.listParts({ kind: "card" });
    const drawn = await Promise.all(cards.map(async part => {
        const card = part as types.chat.Card & types.chat.RegisteredPart;
        const out: any = await ctx.fns.chat.withTimeout({ id: card.id, run: () => card.render(ctx, session, view) });
        if (!out) return "";
        const rows: types.chat.CardRow[] = Array.isArray(out) ? out : typeof out === "object" ? out.rows ?? [] : [];
        const html = typeof out === "string" ? out : !Array.isArray(out) && typeof out === "object" ? String(out.html ?? "") : "";
        if (!rows.length && !html) return "";
        const icon = card.icon ? `<i class="ph ${esc(card.icon)} text-sm" aria-hidden="true"></i>` : "";
        const danger = card.id === "danger";
        return `<section class="chat-card min-w-0 rounded-xl border ${danger ? "border-error/25" : "border-ui-border"} bg-base-100/60 p-2${card.size === "L" ? " col-span-2" : ""}" data-chat-id="${esc(card.id)}">
  <h3 class="mb-1 flex items-center gap-1.5 px-1 text-3xs font-semibold uppercase tracking-wide ${danger ? "text-error/80" : "text-faint"}">${icon}${esc(card.title)}</h3>
  ${html}${rows.length ? `<div class="flex flex-col">${ctx.fns.chat.renderCardRows({ rows })}</div>` : ""}
</section>`;
    }));
    const a = view.agent;
    const head = `<div class="mb-2 flex items-center gap-2 px-1">${ctx.fns.chat.icon({ icon: a.icon, model: a.model, size: "md" })}<div class="min-w-0"><div class="truncate text-sm font-medium text-base-content">${esc(a.title || a.id)}</div><div class="truncate font-mono text-3xs text-faint">${esc(a.id)} · ${esc(a.model)}</div></div></div>`;
    return `${head}<div class="grid grid-cols-2 gap-2">${drawn.filter(Boolean).join("")}</div>`;
}
