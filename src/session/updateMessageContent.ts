// Fill in a message that was written as a placeholder.
//
// A tool result row is created the moment its call is — empty, marked pending —
// so the transcript is never in a state a provider refuses. This is what turns
// it into the real answer once the tool returns.
/** Replace a persisted placeholder's content and optionally its immutable result reference. Omit result_ref to preserve it; pass null to clear it. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Zero-based message or event index. */
    idx: number;
        /** Text content for the operation. */
    content: any;
        /** Immutable result metadata; omitted preserves the stored reference, null clears it. */
    result_ref?: types.agent.ResultRef | null;
        /** Ts used by the operation. */
    ts?: number },
): Promise<{ changed: number }> {
    // Same shape rule as appendMessage: prose stays text, structured
    // (multimodal) content is stored as JSON in the same column.
    const content = (typeof opts.content === "string" || opts.content == null
        ? String(opts.content ?? "")
        : JSON.stringify(opts.content)).replaceAll("\u0000", "\uFFFD");
    const res = await ctx.fns.procs.db.run({
        sql: opts.result_ref === undefined
            ? "UPDATE messages SET content = ? WHERE agent_id = ? AND idx = ?"
            : "UPDATE messages SET content = ?, result_ref = ?::jsonb WHERE agent_id = ? AND idx = ?",
        params: opts.result_ref === undefined
            ? [content, opts.id, opts.idx]
            : [content, opts.result_ref == null ? null : JSON.stringify(opts.result_ref), opts.id, opts.idx],
    });
    await ctx.fns.procs.db.run({
        sql: "UPDATE agents SET updated_at = ? WHERE id = ?",
        params: [opts.ts ?? Date.now(), opts.id],
    });
    return { changed: res.changes };
}
