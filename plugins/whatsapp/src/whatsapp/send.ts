/**
 * WRITE: sends a text message to a WhatsApp chat after explicit confirmation.
 *
 * Use only after the person approved the exact text and recipient; without confirm: true it throws and sends nothing.
 *
 * @param opts.chat Recipient chat JID, phone number or name fragment.
 * @param opts.text Message body.
 * @param opts.confirm Must be true to actually send.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Recipient chat JID, phone number in international format, or chat/contact name fragment. */
    chat: string;
    /** Message text to send. */
    text: string;
    /** Must be true, set only after explicit user approval of this exact message. @default false */
    confirm?: boolean;
}): Promise<{ jid: string; id: string | null; ts: string }> {
    if (!opts?.chat) throw new Error("whatsapp.send: opts.chat required");
    if (!opts?.text) throw new Error("whatsapp.send: opts.text required");
    if (opts.confirm !== true) throw new Error("whatsapp.send is a real write; repeat with confirm: true after explicit user approval");
    const jid = await ctx.fns.whatsapp.resolveChat({ chat: opts.chat });
    const { sock } = await ctx.fns.whatsapp.client({ waitMs: 20000, requireOpen: true });
    const res: any = await sock.sendMessage(jid, { text: opts.text });
    return { jid, id: res?.key?.id ?? null, ts: new Date().toISOString() };
}
