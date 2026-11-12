// Drop messages at DB idx >= `from` (inclusive) AND the UI events that render
// them, so "delete from here" actually clears the chat bubbles (the UI is
// driven by the events table, not messages) and the LLM transcript together.
//
// `from` is a DB message idx (what the delete button posts as messageIdx),
// NOT an array position. We delete by idx directly — no getMessages →
// replaceMessages round-trip — so surviving rows keep their idx, their
// excluded_from_cursor / excluded_from_llm flags, and stay aligned with their
// events. Renumbering would strand every event.messageIdx.
//
// Walks back if `from` lands inside a marker pair so we never leave half a pair:
// assistant §eval / §write:<path> / §bash / §html → user §result:* / §error:*.
// Marker format lives in one place — ctx.fns.agent.markerKind.
/** Truncate messages from for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** From used by the operation. */
from: number }): Promise<{ ok: boolean; from?: number; reason?: string }> {
    const { id, from } = opts;
    if (!Number.isInteger(from) || from < 0) return { ok: false, reason: "invalid idx" };

    const rows = (await ctx.fns.procs.db.select({
        sql: "SELECT idx, role, content, tool_calls, tool_call_id FROM messages WHERE agent_id = ? ORDER BY idx",
        params: [id],
    })) as any[];
    // First to-be-deleted row at or after `from` (robust to idx gaps).
    let p = rows.findIndex((r: any) => Number(r.idx) >= from);
    if (p < 0) return { ok: false, reason: "invalid idx" };

    // Walk back over a marker pair boundary.
    while (p > 0) {
        const cur = rows[p];
        const prev = rows[p - 1];
        // A tool result cannot outlive the call it answers, and vice versa —
        // the provider rejects a transcript with either half missing.
        const curIsResult = cur.role === "tool" || cur.tool_call_id != null;
        const prevIsInvocation = prev.tool_calls != null;
        if (curIsResult || prevIsInvocation) p -= 1;
        else break;
    }
    const effectiveFrom = Number(rows[p].idx);

    await ctx.fns.procs.db.run({ sql: "DELETE FROM messages WHERE agent_id = ? AND idx >= ?", params: [id, effectiveFrom] });
    await ctx.fns.session.markChanged({ id, messages: effectiveFrom });

    // Truncate events at the matching visual boundary: the earliest event that
    // belongs to a message >= effectiveFrom. Everything after it (later
    // tool_call / thinking / error events that carry no messageIdx) shares a
    // higher event idx and is removed too.
    const evRows = (await ctx.fns.procs.db.select({
        sql: "SELECT idx, payload FROM events WHERE agent_id = ? ORDER BY idx",
        params: [id],
    })) as any[];
    let boundaryEventIdx: number | null = null;
    for (const e of evRows) {
        let mi: any;
        try { mi = JSON.parse(e.payload)?.messageIdx; } catch { mi = undefined; }
        if (mi != null && Number(mi) >= effectiveFrom) { boundaryEventIdx = Number(e.idx); break; }
    }
    if (boundaryEventIdx != null) {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM events WHERE agent_id = ? AND idx >= ?", params: [id, boundaryEventIdx] });
        await ctx.fns.session.markChanged({ id, events: boundaryEventIdx });
    }

    await ctx.fns.attachments.gc({});
    return { ok: true, from: effectiveFrom };
}
