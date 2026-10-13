/**
 * Lists WhatsApp chats and groups from the local mirror, most recently active first.
 *
 * Use to find a chat JID before reading messages or sending. Data comes from the history sync and live events
 * received by the linked device, so it reflects what WhatsApp shared with this device.
 *
 * @param opts.query Optional case-insensitive name or JID filter.
 * @param opts.groups Restrict to groups (true) or personal chats (false).
 * @param opts.limit Maximum number of chats.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Case-insensitive substring of the chat name, contact name or JID. */
    query?: string;
    /** true — only groups, false — only personal chats; omitted — both. */
    groups?: boolean;
    /** Maximum number of chats to return. @default 50 @minimum 1 @maximum 1000 */
    limit?: number;
}): Promise<Array<{ jid: string; name: string | null; isGroup: boolean; unread: number | null; lastTs: string | null; messages: number }>> {
    const where: string[] = []; const params: any[] = [];
    if (opts?.query) { where.push("(COALESCE(c.name, k.name, k.notify) ILIKE ? OR c.jid ILIKE ?)"); params.push(`%${opts.query}%`, `%${opts.query}%`); }
    if (typeof opts?.groups === "boolean") { where.push("c.is_group = ?"); params.push(opts.groups); }
    params.push(Math.max(1, Math.min(opts?.limit ?? 50, 1000)));
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT c.jid, COALESCE(c.name, k.name, k.notify) AS name, c.is_group, c.unread, c.last_ts,
        (SELECT count(*) FROM whatsapp.messages m WHERE m.chat_jid = c.jid)::int AS messages
        FROM whatsapp.chats c LEFT JOIN whatsapp.contacts k ON k.jid = c.jid ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY c.last_ts DESC NULLS LAST LIMIT ?`, params });
    return rows.map((r: any) => ({ jid: r.jid, name: r.name, isGroup: r.is_group, unread: r.unread, lastTs: r.last_ts ? new Date(r.last_ts).toISOString() : null, messages: r.messages }));
}
