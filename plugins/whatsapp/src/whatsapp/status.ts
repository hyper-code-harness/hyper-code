/**
 * Reports whether the WhatsApp linked device is connected and how much is mirrored locally.
 *
 * Use before reading or writing to check the link; status "qr" or "loggedOut" means whatsapp.login({}) is needed.
 *
 * @param opts.waitMs Maximum time to wait for the connection to settle.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Maximum time in milliseconds to wait for the connection to open. @default 5000 @minimum 0 @maximum 60000 */
    waitMs?: number;
}): Promise<{ status: string; linked: boolean; me?: { id: string; name?: string }; lastError?: string; mirror: { chats: number; messages: number; contacts: number; newest: string | null } }> {
    const c = await ctx.fns.whatsapp.client({ waitMs: opts?.waitMs ?? 5000 });
    const [row] = await ctx.fns.procs.db.select({ sql: `SELECT (SELECT count(*) FROM whatsapp.chats)::int AS chats, (SELECT count(*) FROM whatsapp.messages)::int AS messages,
        (SELECT count(*) FROM whatsapp.contacts)::int AS contacts, (SELECT max(ts) FROM whatsapp.messages) AS newest` });
    return { status: c.status, linked: c.status === "open", me: c.me, lastError: c.lastError, mirror: { chats: row.chats, messages: row.messages, contacts: row.contacts, newest: row.newest ? new Date(row.newest).toISOString() : null } };
}
