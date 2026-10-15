/**
 * Renders the chat header parts of one kind for a chat, in parallel, each under a 1.5 s budget.
 *
 * A part that throws, times out or returns null/"" is left out and logged; it never breaks the chat. Returns
 * the drawn HTML of every part that rendered, in display order (see chat.listParts).
 * @param opts.kind badge or button.
 * @param opts.context The chat being drawn.
 * @param opts.budgetMs Time one part may take. @default 1500
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** badge or button. */
        kind: "badge" | "button";
        /** The chat being drawn. */
        context: types.chat.RenderContext;
        /** Time one part may take. @default 1500 */
        budgetMs?: number;
    },
): Promise<string[]> {
    const list = await ctx.fns.chat.listParts({ kind: opts.kind });
    const drawn = await Promise.all(list.map(async part => {
        const out = await ctx.fns.chat.withTimeout({ id: part.id, budgetMs: opts.budgetMs, run: () => (part as types.chat.Badge).render(ctx, session, opts.context) });
        if (!out) return "";
        const html = typeof out === "string" ? out : ctx.fns.chat.renderItem({ id: part.id, item: out as types.chat.Item, side: opts.kind });
        return html ? `<span class="chat-part flex min-w-0 shrink-0 items-center" data-chat-id="${ctx.fns.procs.ui.escape({ text: part.id })}">${html}</span>` : "";
    }));
    return drawn.filter(Boolean);
}
