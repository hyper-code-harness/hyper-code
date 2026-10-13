/**
 * Searches message text across all mirrored WhatsApp chats, newest first.
 *
 * Use to find where something was discussed when the chat is unknown.
 *
 * @param opts.query Case-insensitive text to look for.
 * @param opts.limit Maximum number of hits.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Case-insensitive substring to search for in message text. */
    query: string;
    /** Maximum number of matching messages. @default 30 @minimum 1 @maximum 500 */
    limit?: number;
}): Promise<Array<{ chat: string; chatName: string | null; id: string; ts: string | null; fromMe: boolean; name: string | null; text: string | null }>> {
    if (!opts?.query) throw new Error("whatsapp.search: query required");
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT m.chat_jid, COALESCE(c.name, kc.name, kc.notify) AS chat_name, m.id, m.ts, m.from_me, COALESCE(k.name, k.notify, m.push_name) AS name, m.text
        FROM whatsapp.messages m LEFT JOIN whatsapp.chats c ON c.jid = m.chat_jid LEFT JOIN whatsapp.contacts kc ON kc.jid = m.chat_jid LEFT JOIN whatsapp.contacts k ON k.jid = m.sender
        WHERE m.text ILIKE ? ORDER BY m.ts DESC NULLS LAST LIMIT ?`, params: [`%${opts.query}%`, Math.max(1, Math.min(opts.limit ?? 30, 500))] });
    return rows.map((r: any) => ({ chat: r.chat_jid, chatName: r.chat_name, id: r.id, ts: r.ts ? new Date(r.ts).toISOString() : null, fromMe: r.from_me, name: r.name, text: r.text }));
}
