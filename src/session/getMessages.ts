/** Get messages for the runtime. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Whether to include entries excluded from the processing cursor. */
    includeExcluded?: boolean },
): Promise<any[]> {
    const { id } = opts;
    const includeExcluded = opts.includeExcluded === true;
    const rows = (await ctx.fns.procs.db.select({
        sql: 'SELECT * FROM messages WHERE agent_id = ? AND (? = 1 OR COALESCE(excluded_from_llm, 0) = 0) ORDER BY idx',
        params: [id, includeExcluded ? 1 : 0],
    })) as any[];

    return rows.map((r: any) => {
        const m: any = { role: r.role, idx: Number(r.idx) };
        if (r.content !== null) {
            // Structured multimodal content is stored as JSON text in the same
            // column as prose. Only parse the exact array shape we own; normal
            // user text that happens to begin with `[` remains plain text.
            let content: any = r.content;
            if (typeof content === "string" && content.startsWith("[")) {
                try {
                    const parsed = JSON.parse(content);
                    if (Array.isArray(parsed) && parsed.every((x: any) => ["text", "image", "document", "image_ref", "document_ref"].includes(String(x?.type)))) content = parsed;
                } catch { /* prose, not structured content */ }
            }
            m.content = content;
        }
        // JSONB comes back parsed on some drivers and as text on others.
        if (r.tool_calls != null) m.tool_calls = typeof r.tool_calls === "string" ? JSON.parse(r.tool_calls) : r.tool_calls;
        if (r.tool_call_id != null) m.tool_call_id = r.tool_call_id;
        if (Number(r.excluded_from_llm ?? 0) !== 0) m.excluded_from_llm = true;
        if (r.message_type != null && r.message_type !== "message") m.message_type = r.message_type;
        if (Number(r.excluded_from_cursor ?? 0) !== 0) m.excluded_from_cursor = true;
        if (r.author != null) m.author = r.author;
        return m;
    });
}
