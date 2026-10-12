/**
 * Opens or closes an agent's canvas and sets the chat column width beside it.
 *
 * Use to show the canvas left of the chat (the chat becomes a narrow column on the right) or to hide it.
 * Only the given fields change; items and width survive closing. Every open tab of that chat follows at
 * once through the `canvas.changed` event.
 * @param opts.agentId Agent whose canvas to change.
 * @param opts.open Show (true) or hide (false) the canvas; omit to keep.
 * @param opts.chatWidth Chat column width in px while the canvas is open; omit to keep. @minimum 320 @maximum 1600
 * @param opts.activeItemId Tab to show (one of this agent's canvas tabs), null for none; omit to keep.
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
        /** Tab to show (one of this agent's canvas tabs), null for none; omit to keep. */
        activeItemId?: number | null;
    },
): Promise<types.canvas.View> {
    return (await ctx.fns.canvas.locked({
        agentId: opts.agentId,
        fn: async () => {
            const sets: string[] = [];
            const params: any[] = [];
            if (typeof opts.open === "boolean") { sets.push("open = ?"); params.push(opts.open); }
            if (opts.chatWidth != null && Number.isFinite(Number(opts.chatWidth))) { sets.push("chat_width = ?"); params.push(Math.round(Math.min(1600, Math.max(320, Number(opts.chatWidth))))); }
            if (opts.activeItemId !== undefined) {
                const active = opts.activeItemId === null ? null : Number(opts.activeItemId);
                if (active !== null) {
                    const own = (await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM canvas_items WHERE id = ? AND agent_id = ?", params: [active, opts.agentId] })) as any[];
                    if (!own.length) throw new Error(`canvas.update: tab ${active} is not on ${opts.agentId}'s canvas`);
                }
                sets.push("active_item_id = ?"); params.push(active);
            }
            // Only the given fields change, so a width save never undoes a tab switch made meanwhile.
            if (sets.length) await ctx.fns.procs.db.run({ sql: `UPDATE canvas_state SET ${sets.join(", ")}, updated_at = ? WHERE agent_id = ?`, params: [...params, Date.now(), opts.agentId] });
            return await ctx.fns.canvas.get({ agentId: opts.agentId });
        },
    })) as types.canvas.View;
}
