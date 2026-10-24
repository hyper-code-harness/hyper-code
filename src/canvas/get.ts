/**
 * Reads an agent's canvas state (open, chat width, chat folded, active item).
 *
 * Whether the canvas is open beside the agent's chat, the chat column width while it is, and the active
 * item. An agent that never opened its canvas gets the defaults: closed, 440px, no item.
 * @param opts.agentId Agent whose canvas to read.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose canvas to read. */
        agentId: string;
    },
): Promise<types.canvas.View> {
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT open, chat_width, chat_collapsed, active_item_id FROM canvas_state WHERE agent_id = ?", params: [opts.agentId] }).catch(() => [])) as any[])[0];
    return {
        agentId: opts.agentId,
        open: row?.open === true,
        chatWidth: Number(row?.chat_width) || 440,
        chatCollapsed: row?.open === true && row?.chat_collapsed === true,
        activeItemId: row?.active_item_id == null ? null : Number(row.active_item_id),
    };
}
