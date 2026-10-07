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
    ts?: number;
        /** Stable client submission id used to make retries idempotent. */
    clientRequestId?: string },
): Promise<{ idx: number; duplicate?: boolean }> {
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
        sql: `INSERT INTO messages (agent_id, idx, role, content, tool_calls, tool_call_id, message_type, ts, excluded_from_llm, excluded_from_cursor, author, client_request_id)
              SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM messages WHERE agent_id = ?
              ON CONFLICT (agent_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
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
            opts.clientRequestId?.trim() || null,
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
        await ctx.fns.mentions.record({ agentId: id, messageIdx: idx, text: message.content, from: message.role === 'assistant' ? `agent:${id}` : message.author ?? null })
            .catch((error: any) => ctx.fns.procs.log.warn({ event: 'mentions.record.failed', msg: String(error?.message ?? error), agentId: id }));
    }
    return { idx };
}
