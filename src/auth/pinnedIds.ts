/**
 * Returns the ids of chats pinned by the current user.
 *
 * Reads user_agent_state for an identified viewer; before the switch (no users) reads the legacy
 * shared kv keys `mobile-pin-agent:<agent>`, exactly as before.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<Set<string>> {
    const userId = await ctx.fns.auth.viewerId({});
    const rows = userId
        ? await ctx.fns.procs.db.select({ sql: "SELECT agent_id AS id FROM user_agent_state WHERE user_id = ? AND pinned", params: [userId] })
        : await ctx.fns.procs.db.select({ sql: "SELECT substring(key FROM 18) AS id FROM kv WHERE key LIKE 'mobile-pin-agent:%'" });
    return new Set((rows as any[]).map((r) => String(r.id)));
}
