/**
 * Resolves a chat reference (JID, phone number or a name fragment) to a WhatsApp JID from the local mirror.
 *
 * Use inside whatsapp.* functions to accept human chat references. A value containing "@" is returned as is;
 * digits-only values become a personal JID; otherwise the best name match among chats and contacts is used.
 *
 * @param opts.chat Chat JID, phone number in international format, or a part of a chat or contact name.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chat JID (e.g. 351912345678@s.whatsapp.net or 1203...@g.us), phone number, or chat/contact name fragment. */
    chat: string;
}): Promise<string> {
    const q = String(opts?.chat ?? "").trim();
    if (!q) throw new Error("whatsapp: chat required");
    if (q.includes("@")) return q;
    const digits = q.replace(/[\s+\-()]/g, "");
    if (/^\d{7,15}$/.test(digits)) return `${digits}@s.whatsapp.net`;
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT jid FROM (
        SELECT c.jid, COALESCE(c.name, k.name, k.notify) AS name, c.last_ts FROM whatsapp.chats c LEFT JOIN whatsapp.contacts k ON k.jid = c.jid
        UNION ALL SELECT k.jid, COALESCE(k.name, k.notify), NULL FROM whatsapp.contacts k) x
        WHERE name ILIKE ? ORDER BY (lower(name) = lower(?)) DESC, last_ts DESC NULLS LAST LIMIT 1`, params: [`%${q}%`, q] });
    if (!rows.length) throw new Error(`whatsapp: no chat matches "${q}"`);
    return rows[0].jid;
}
