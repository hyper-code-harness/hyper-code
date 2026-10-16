/** Append a transcript message, preserving native tool identity and immutable result metadata. Retries with clientRequestId are idempotent. */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Message to persist or process. */
    message: types.session.Message;
        /** Ts used by the operation. */
    ts?: number;
        /** Stable client submission id used to make retries idempotent. */
    clientRequestId?: string },
): Promise<{ idx: number; duplicate?: boolean }> {
    const { id, message } = opts;
    // PostgreSQL UTF-8/jsonb rejects NUL and unpaired UTF-16 surrogates. Provider
    // output can contain either, so scrub every string destined for text or JSONB.
    const safe = (text: string) => ctx.fns.session.scrubUnicode({ text });
    const safeValue = async (value: any): Promise<any> => {
        if (typeof value === "string") return await safe(value);
        if (Array.isArray(value)) return await Promise.all(value.map(safeValue));
        if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, entry]) => [key, await safeValue(entry)])));
        return value;
    };
    if (typeof message.content === 'string') message.content = await safe(message.content);
    const content = typeof message.content === "string" ? message.content : (message.content == null ? null : JSON.stringify(await safeValue(message.content)));
    const toolCalls = message.tool_calls?.length ? JSON.stringify(await safeValue(message.tool_calls)) : null;
    const resultRef = message.result_ref == null ? null : JSON.stringify(await safeValue(message.result_ref));
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
        sql: `INSERT INTO messages (agent_id, idx, role, content, tool_calls, tool_call_id, message_type, ts, excluded_from_llm, excluded_from_cursor, author, client_request_id, result_ref)
              SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb FROM messages WHERE agent_id = ?
              ON CONFLICT (agent_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
              RETURNING idx`,
        params: [
            id,
            message.role,
            content,
            toolCalls,
            message.tool_call_id ?? null,
            // Order follows the column list above — message_type sits BETWEEN
            // tool_call_id and ts. Swapping the two put the string "message"
            // into the bigint ts slot and every append 500'd.
            message.message_type ?? "message",
            ts,
            message.excluded_from_llm ? 1 : 0,
            message.excluded_from_cursor ? 1 : 0,
            message.author ?? null,
            opts.clientRequestId?.trim() || null,
            resultRef,
            id,
        ],
            });
            idx = Number((res.rows as any[])?.[0]?.idx ?? -1);
            if (idx < 0 && opts.clientRequestId?.trim()) {
                const existing = (await ctx.fns.procs.db.select({ sql: "SELECT idx FROM messages WHERE agent_id = ? AND client_request_id = ?", params: [id, opts.clientRequestId.trim()] }) as any[])[0];
                if (existing) return { idx: Number(existing.idx), duplicate: true };
            }
            break;
        } catch (e: any) {
            if (attempt >= 9 || !/duplicate key|messages_pkey/i.test(String(e?.message ?? e))) throw e;
            // Jittered backoff: a simultaneous burst all reads the same MAX —
            // without a pause the retries collide in lockstep too.
            await new Promise(r => setTimeout(r, 3 + Math.random() * 20 * (attempt + 1)));
        }
    }
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET updated_at = ? WHERE id = ?', params: [ts, id] });
    // Words a person or an agent said may @mention people; context rows (status line, world state…) never do.
    const said = (message.role === 'user' || message.role === 'assistant')
        && typeof message.content === 'string' && message.content.includes('@')
        && (message.message_type == null || message.message_type === 'message' || message.message_type === 'agent_message');
    if (said) {
        await ctx.fns.mentions.record({ agentId: id, messageIdx: idx, text: String(message.content), from: message.role === 'assistant' ? `agent:${id}` : message.author ?? null })
            .catch((error: any) => ctx.fns.procs.log.warn({ event: 'mentions.record.failed', msg: String(error?.message ?? error), agentId: id }));
    }
    return { idx };
}
