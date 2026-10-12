/**
 * Opens or closes an agent's canvas and sets the chat column width beside it.
 *
 * Use to show the canvas left of the chat (the chat becomes a narrow column on the right) or to hide it.
 * Only the given fields change; items and width survive closing. Every open tab of that chat follows at
 * once through the `canvas.changed` event.
 * @param opts.agentId Agent whose canvas to change.
 * @param opts.open Show (true) or hide (false) the canvas; omit to keep.
 * @param opts.chatWidth Chat column width in px while the canvas is open; omit to keep. @minimum 320 @maximum 1600
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose canvas to change. */
        agentId: string;
        /** Show (true) or hide (false) the canvas; omit to keep. */
        open?: boolean;
        /** Chat column width in px while the canvas is open; omit to keep. @minimum 320 @maximum 1600 */
        chatWidth?: number;
    },
): Promise<types.canvas.State> {
    const before = await ctx.fns.canvas.get({ agentId: opts.agentId });
    const open = typeof opts.open === "boolean" ? opts.open : before.open;
    const width = opts.chatWidth == null ? before.chatWidth : Math.round(Math.min(1600, Math.max(320, Number(opts.chatWidth) || before.chatWidth)));
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO canvas_state (agent_id, open, chat_width, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (agent_id) DO UPDATE SET open = excluded.open, chat_width = excluded.chat_width, updated_at = excluded.updated_at`,
        params: [opts.agentId, open, width, Date.now()],
    });
    const after = { ...before, open, chatWidth: width };
    ctx.fns.procs.events.emit({ event: { type: "canvas.changed", agentId: opts.agentId, open, chatWidth: width } });
    return after;
}
