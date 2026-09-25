/** Append message for the runtime. */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Message to persist or process. */
    message: any;
        /** Ts used by the operation. */
    ts?: number },
): Promise<{ idx: number }> {
    const { id, message } = opts;
    // Postgres text refuses NUL bytes — scrub at the boundary so one stray \0
    // in a marker result / pasted text can't fail the INSERT and kill a run.
    if (typeof message.content === 'string' && message.content.includes('\u0000')) {
        message.content = message.content.replaceAll('\u0000', '\uFFFD');
    }
    const ts = opts.ts ?? Date.now();
    // Only human turns carry an author; assistant and tool rows are the agent's own.
    if (message.role === "user" && message.author === undefined) message.author = await ctx.fns.auth.actorId({ agentId: id });
    // Native tool calls carry identity the text cannot: `tool_calls` is the
    // canonical [{ id, name, args }] an assistant emitted, `tool_call_id` says
    // which of them a role:"tool" message answers. Marker transcripts leave
    // both NULL.
    // Same race, same cure as appendEvent: allocate idx inside the insert and
    // retry a duplicate — concurrent user/assistant appends collided here too.
    let idx = -1;
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await ctx.fns.procs.db.run({
        sql: `INSERT INTO messages (agent_id, idx, role, content, tool_calls, tool_call_id, message_type, ts, excluded_from_llm, excluded_from_cursor, author)
              SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM messages WHERE agent_id = ?
              RETURNING idx`,
        params: [
            id,
            message.role,
            typeof message.content === "string" ? message.content : (message.content == null ? null : JSON.stringify(message.content)),
            message.tool_calls?.length ? JSON.stringify(message.tool_calls) : null,
            message.tool_call_id ?? null,
            // Order follows the column list above — message_type sits BETWEEN
            // tool_call_id and ts. Swapping the two put the string "message"
            // into the bigint ts slot and every append 500'd.
            message.message_type ?? "message",
            ts,
            message.excluded_from_llm ? 1 : 0,
            message.excluded_from_cursor ? 1 : 0,
            message.author ?? null,
            id,
        ],
            });
            idx = Number((res.rows as any[])?.[0]?.idx ?? -1);
            break;
        } catch (e: any) {
            if (attempt >= 9 || !/duplicate key|messages_pkey/i.test(String(e?.message ?? e))) throw e;
            // Jittered backoff: a simultaneous burst all reads the same MAX —
            // without a pause the retries collide in lockstep too.
            await new Promise(r => setTimeout(r, 3 + Math.random() * 20 * (attempt + 1)));
        }
    }
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET updated_at = ? WHERE id = ?', params: [ts, id] });
    return { idx };
}
