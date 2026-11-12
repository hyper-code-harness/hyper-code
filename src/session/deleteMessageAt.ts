// Delete a single message by its DB idx, plus the UI event(s) that render it,
// so the chat bubble actually disappears (the UI is driven by the events
// table). Refuses to delete one half of a marker pair (would strand the other
// half) — for those use truncateMessagesFrom, which walks the pair boundary.
//
// `idx` is a DB message idx (what the delete button posts as messageIdx), NOT
// an array position. We delete by idx directly — no getMessages →
// replaceMessages round-trip — so surviving rows keep their idx and flags and
// stay aligned with their events. The resulting idx gap is harmless (reads are
// ORDER BY idx, appends use MAX(idx)+1). Marker format lives in one place —
// ctx.fns.agent.markerKind.
/** Delete message at for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Zero-based message or event index. */
idx: number }): Promise<{ ok: boolean; reason?: string }> {
    const { id, idx } = opts;
    if (!Number.isInteger(idx) || idx < 0) return { ok: false, reason: "invalid idx" };

    const target = ((await ctx.fns.procs.db.select({
        sql: "SELECT idx, role, content, tool_calls, tool_call_id FROM messages WHERE agent_id = ? AND idx = ?",
        params: [id, idx],
    })) as any[])[0];
    if (!target) return { ok: false, reason: "not found" };
    const kind = target.role === "tool" || target.tool_call_id != null ? "result"
        : target.tool_calls != null ? "invocation" : null;
    if (target.role === "assistant" && kind === "invocation") {
        return { ok: false, reason: "cannot delete assistant tool-call message alone; use delete from here" };
    }
    if ((target.role === "user" || target.role === "tool") && kind === "result") {
        return { ok: false, reason: "cannot delete tool-result message alone; use delete from here" };
    }

    await ctx.fns.procs.db.run({ sql: "DELETE FROM messages WHERE agent_id = ? AND idx = ?", params: [id, idx] });
    await ctx.fns.session.markChanged({ id, messages: idx });

    // Remove the event(s) that render this exact message (user / assistant
    // bubbles carry messageIdx). Leaves surrounding events untouched.
    const evRows = (await ctx.fns.procs.db.select({
        sql: "SELECT idx, payload FROM events WHERE agent_id = ? ORDER BY idx",
        params: [id],
    })) as any[];
    for (const e of evRows) {
        let mi: any;
        try { mi = JSON.parse(e.payload)?.messageIdx; } catch { mi = undefined; }
        if (mi != null && Number(mi) === idx) {
            await ctx.fns.procs.db.run({ sql: "DELETE FROM events WHERE agent_id = ? AND idx = ?", params: [id, Number(e.idx)] });
            await ctx.fns.session.markChanged({ id, events: Number(e.idx) });
        }
    }

    await ctx.fns.attachments.gc({});
    return { ok: true };
}
