/**
 * Reads messages of one WhatsApp chat from the local mirror, oldest to newest, optionally filtered by text.
 *
 * Use to read a conversation or group after finding it with whatsapp.chats. Does not mark anything as read.
 *
 * @param opts.chat Chat JID, phone number or name fragment.
 * @param opts.limit Number of most recent messages.
 * @param opts.query Optional case-insensitive text filter.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chat JID, phone number, or chat/contact name fragment. */
    chat: string;
    /** Number of most recent matching messages to return. @default 50 @minimum 1 @maximum 2000 */
    limit?: number;
    /** Case-insensitive substring that the message text must contain. */
    query?: string;
}): Promise<{ jid: string; messages: Array<{ id: string; ts: string | null; fromMe: boolean; sender: string | null; name: string | null; type: string | null; text: string | null }> }> {
    const jid = await ctx.fns.whatsapp.resolveChat({ chat: opts.chat });
    const params: any[] = [jid]; let filter = "";
    if (opts?.query) { filter = "AND m.text ILIKE ?"; params.push(`%${opts.query}%`); }
    params.push(Math.max(1, Math.min(opts?.limit ?? 50, 2000)));
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT * FROM (SELECT m.id, m.ts, m.from_me, m.sender, COALESCE(k.name, k.notify, m.push_name) AS name, m.type, m.text
        FROM whatsapp.messages m LEFT JOIN whatsapp.contacts k ON k.jid = m.sender WHERE m.chat_jid = ? ${filter} ORDER BY m.ts DESC NULLS LAST LIMIT ?) x ORDER BY ts ASC NULLS FIRST`, params });
    return { jid, messages: rows.map((r: any) => ({ id: r.id, ts: r.ts ? new Date(r.ts).toISOString() : null, fromMe: r.from_me, sender: r.sender, name: r.name, type: r.type, text: r.text })) };
}
