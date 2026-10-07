/**
 * Records the mentions (@id) of one saved chat message as unread mentions of each mentioned person.
 *
 * Called when a message is saved (session.appendMessage does it for user and assistant rows). The author is
 * never notified of their own mention; saving the same message twice records nothing new. Tabs are told
 * through the `mentions.changed` event so the mentioned person's badge and toast update at once.
 * @param opts.agentId Chat (agent) the message belongs to.
 * @param opts.messageIdx Index of the saved message in that chat.
 * @param opts.text Message text containing the mentions.
 * @param opts.from Author of the message: a user id or `agent:<id>`; omitted when unknown.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Chat (agent) the message belongs to. */
        agentId: string;
        /** Index of the saved message in that chat. @minimum 0 */
        messageIdx: number;
        /** Message text containing the mentions. */
        text: string;
        /** Author of the message: a user id or `agent:<id>`; omitted when unknown. */
        from?: string | null;
    },
): Promise<{ mentioned: string[] }> {
    const to = (await ctx.fns.mentions.parse({ text: opts.text })).filter((id) => id !== opts.from);
    if (!to.length) return { mentioned: [] };
    const excerpt = String(opts.text).replace(/\s+/g, " ").trim().slice(0, 240);
    const now = Date.now();
    const mentioned: string[] = [];
    for (const user of to) {
        const res = await ctx.fns.procs.db.run({
            sql: `INSERT INTO mentions (agent_id, message_idx, from_actor, to_user, excerpt, created_at)
                  VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (agent_id, message_idx, to_user) DO NOTHING RETURNING id`,
            params: [opts.agentId, opts.messageIdx, opts.from ?? null, user, excerpt, now],
        });
        if ((res.rows as any[])?.length) mentioned.push(user);
    }
    if (mentioned.length) ctx.fns.procs.events.emit({ event: { type: "mentions.changed", agentId: opts.agentId, to: mentioned } });
    return { mentioned };
}
