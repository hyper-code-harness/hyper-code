/**
 * Lists members of a WhatsApp group with their admin role, fetched live from WhatsApp.
 *
 * Use to see who is in a group the linked account belongs to.
 *
 * @param opts.chat Group JID or group name fragment.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Group JID (…@g.us) or a fragment of the group name. */
    chat: string;
}): Promise<{ jid: string; subject: string; desc: string | null; size: number; participants: Array<{ jid: string; name: string | null; admin: string | null }> }> {
    const jid = await ctx.fns.whatsapp.resolveChat({ chat: opts.chat });
    if (!jid.endsWith("@g.us")) throw new Error(`whatsapp.participants: ${jid} is not a group`);
    const { sock } = await ctx.fns.whatsapp.client({ waitMs: 20000, requireOpen: true });
    const md: any = await sock.groupMetadata(jid);
    const ids = md.participants.map((p: any) => p.id);
    const names = ids.length ? await ctx.fns.procs.db.select({ sql: `SELECT jid, COALESCE(name, notify) AS name FROM whatsapp.contacts WHERE jid IN (SELECT jsonb_array_elements_text(?::jsonb))`, params: [JSON.stringify(ids)] }) : [];
    const byJid = new Map(names.map((r: any) => [r.jid, r.name]));
    return { jid, subject: md.subject, desc: md.desc ?? null, size: md.size ?? md.participants.length, participants: md.participants.map((p: any) => ({ jid: p.id, name: (byJid.get(p.id) as string) ?? null, admin: p.admin ?? null })) };
}
