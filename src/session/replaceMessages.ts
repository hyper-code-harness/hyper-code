/** Replace messages for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Messages to persist or process. */
messages: any[];
        /** Ts used by the operation. */
ts?: number }): Promise<{ count: number }> {
    const { id, messages } = opts;
    const ts = opts.ts ?? Date.now();
    await ctx.fns.procs.db.run({ sql: 'DELETE FROM messages WHERE agent_id = ?', params: [id] });
    for (let i = 0; i < messages.length; i++) {
        const m: any = messages[i];
        await ctx.fns.procs.db.run({
            sql: `
            INSERT INTO messages (agent_id, idx, role, content, tool_calls, tool_call_id, message_type, ts, excluded_from_llm, excluded_from_cursor, author)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            params: [
                id,
                i,
                m.role,
                typeof m.content === "string" ? m.content : (m.content == null ? null : JSON.stringify(m.content)),
                m.tool_calls?.length ? JSON.stringify(m.tool_calls) : null,
                m.tool_call_id ?? null,
                m.message_type ?? "message",
                ts,
                m.excluded_from_llm ? 1 : 0,
                m.excluded_from_cursor ? 1 : 0,
                m.author ?? null,
            ],
        });
    }
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET updated_at = ? WHERE id = ?', params: [ts, id] });
    await ctx.fns.attachments.gc({});
    return { count: messages.length };
}
