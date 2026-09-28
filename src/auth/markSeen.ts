/**
 * Marks a chat read for the current user, up to its newest event.
 *
 * Writes the per-user row in user_agent_state. Also keeps the legacy shared kv key
 * `seen-at:<agent>` in sync while the instance has at most one user, so the previous code sees the
 * same read state after a rollback. With no identified user (not switched yet) only kv is written.
 * Returns the watermark timestamp.
 * @param opts.agentId Chat (agent) id.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Chat (agent) id. */
        agentId: string;
    },
): Promise<number> {
    const db = ctx.fns.procs.db;
    const row = ((await db.select({ sql: "SELECT MAX(ts) AS ts FROM events WHERE agent_id = ?", params: [opts.agentId] })) as any[])[0];
    const seenAt = row?.ts == null ? Date.now() : Number(row.ts);
    const userId = await ctx.fns.auth.viewerId({});
    if (userId) {
        await db.run({
            sql: `INSERT INTO user_agent_state (user_id, agent_id, seen_at, updated_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (user_id, agent_id) DO UPDATE SET seen_at = GREATEST(COALESCE(user_agent_state.seen_at, 0), EXCLUDED.seen_at), updated_at = EXCLUDED.updated_at`,
            params: [userId, opts.agentId, seenAt, Date.now()],
        });
    }
    if (!userId || (await ctx.fns.auth.listUsers({})).length <= 1) {
        await db.run({ sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", params: [`seen-at:${opts.agentId}`, String(seenAt)] });
    }
    return seenAt;
}
