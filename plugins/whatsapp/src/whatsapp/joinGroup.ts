/**
 * WRITE: joins a WhatsApp group by invite link after explicit confirmation.
 *
 * Use only after the person approved joining. Without confirm: true it only previews the group (name, size,
 * description) from the invite and does not join.
 *
 * @param opts.inviteLink Invite URL like https://chat.whatsapp.com/<code> or the bare code.
 * @param opts.confirm Must be true to actually join.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Invite link (https://chat.whatsapp.com/<code>) or the invite code itself. */
    inviteLink: string;
    /** Must be true, set only after explicit user approval; otherwise only a preview is returned. @default false */
    confirm?: boolean;
}): Promise<{ joined: boolean; jid: string | null; subject: string | null; size: number | null; desc: string | null }> {
    const code = String(opts?.inviteLink ?? "").trim().replace(/^https?:\/\/chat\.whatsapp\.com\/(invite\/)?/i, "").replace(/[/?#].*$/, "");
    if (!code) throw new Error("whatsapp.joinGroup: inviteLink required");
    const { sock } = await ctx.fns.whatsapp.client({ waitMs: 20000, requireOpen: true });
    const info: any = await sock.groupGetInviteInfo(code).catch(() => null);
    const preview = { jid: info?.id ?? null, subject: info?.subject ?? null, size: info?.size ?? info?.participants?.length ?? null, desc: info?.desc ?? null };
    if (opts.confirm !== true) return { joined: false, ...preview };
    const jid = await sock.groupAcceptInvite(code);
    const id = jid ?? preview.jid;
    if (id) await ctx.fns.procs.db.run({ sql: `INSERT INTO whatsapp.chats(jid, name, is_group, updated_at) VALUES (?, ?, true, now()) ON CONFLICT (jid) DO UPDATE SET name = COALESCE(EXCLUDED.name, whatsapp.chats.name)`, params: [id, preview.subject] });
    return { joined: true, ...preview, jid: id };
}
