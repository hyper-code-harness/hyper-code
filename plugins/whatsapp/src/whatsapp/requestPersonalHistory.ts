/**
 * Requests one page of older WhatsApp messages for an exact personal chat already present in the local mirror.
 *
 * Use when a linked WhatsApp account has incomplete history for a known personal chat. The request goes to the linked phone; any response arrives asynchronously in the local mirror. A request ID is not proof of delivery. Chats without a mirrored message to serve as a cursor cannot be fetched this way. Does not send a chat message or mark it read.
 * @param opts.chat Exact personal chat JID from whatsapp.chats (ending in @lid or @s.whatsapp.net). Names and group JIDs are not accepted.
 * @param opts.limit Maximum number of older messages to request in this page. @default 50 @minimum 1 @maximum 50
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact personal chat JID from whatsapp.chats (ending in @lid or @s.whatsapp.net). Names and group JIDs are not accepted. */
        chat: string;
        /** Maximum number of older messages to request in this page. @default 50 @minimum 1 @maximum 50 */
        limit?: number;
    },
): Promise<{ status: "requested"; requestId: string; anchorTs: string } | { status: "no_anchor" }> {
    const chat = opts.chat?.trim();
    if (!chat || !/^\d+(?:_\d+)?@(?:lid|s\.whatsapp\.net)$/.test(chat)) throw new Error("Expected an exact personal WhatsApp chat JID from whatsapp.chats");
    const limit = opts.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer from 1 to 50");
    const [anchor] = await ctx.fns.procs.db.select({ sql: "SELECT id, from_me, ts FROM whatsapp.messages WHERE chat_jid = ? AND ts IS NOT NULL ORDER BY ts ASC, id ASC LIMIT 1", params: [chat] });
    if (!anchor) return { status: "no_anchor" };
    const ts = new Date(anchor.ts);
    // Baileys 6.7 takes the WebMessageInfo timestamp (seconds), as in its documented example.
    const cursor = Math.floor(ts.getTime() / 1000);
    if (!Number.isSafeInteger(cursor) || cursor < 1) throw new Error("The local history cursor has an invalid timestamp");
    const { sock } = await ctx.fns.whatsapp.client({ requireOpen: true });
    const requestId: string = await sock.fetchMessageHistory(limit, { remoteJid: chat, id: anchor.id, fromMe: anchor.from_me }, cursor);
    return { status: "requested", requestId, anchorTs: ts.toISOString() };
}
