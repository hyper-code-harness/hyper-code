/**
 * Pins or unpins a chat for the current user.
 *
 * Writes the per-user row in user_agent_state and, while the instance has at most one user, the
 * legacy shared kv key `mobile-pin-agent:<agent>`, so a rollback to the previous code keeps pins.
 * With no identified user (not switched yet) only kv is written.
 * @param opts.agentId Chat (agent) id.
 * @param opts.pinned True to pin, false to unpin.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Chat (agent) id. */
        agentId: string;
        /** True to pin, false to unpin. */
        pinned: boolean;
    },
): Promise<boolean> {
    const db = ctx.fns.procs.db;
    const userId = await ctx.fns.auth.viewerId({});
    if (userId) {
        await db.run({
            sql: `INSERT INTO user_agent_state (user_id, agent_id, pinned, updated_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (user_id, agent_id) DO UPDATE SET pinned = EXCLUDED.pinned, updated_at = EXCLUDED.updated_at`,
            params: [userId, opts.agentId, !!opts.pinned, Date.now()],
        });
    }
    if (!userId || (await ctx.fns.auth.listUsers({})).length <= 1) {
        const key = `mobile-pin-agent:${opts.agentId}`;
        if (opts.pinned) await db.run({ sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", params: [key, String(Date.now())] });
        else await db.run({ sql: "DELETE FROM kv WHERE key = ?", params: [key] });
    }
    return !!opts.pinned;
}
