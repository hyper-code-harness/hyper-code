/**
 * Opens the compact-context form of a chat in the app popup (the ⋯ panel's Compact row).
 * @param opts.agentId Agent whose context is compacted.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose context is compacted. */
    agentId: string;
}): Response {
    return new Response(ctx.fns.ui.popupContent({ title: "Compact context", html: ctx.fns.chat.compactForm({ agentId: opts.agentId }) }), { headers: { "content-type": "text/html; charset=utf-8" } });
}
