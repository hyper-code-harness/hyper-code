/**
 * WRITE: unlinks this device from the WhatsApp account and deletes the saved session after confirmation.
 *
 * Use only when the person asks to disconnect WhatsApp. The local message mirror is kept.
 *
 * @param opts.confirm Must be true to actually log out.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Must be true, set only after explicit user approval. @default false */
    confirm?: boolean;
}): Promise<{ loggedOut: boolean }> {
    if (opts?.confirm !== true) throw new Error("whatsapp.logout unlinks the device; repeat with confirm: true after explicit user approval");
    const { sock } = await ctx.fns.whatsapp.client({ waitMs: 10000, requireOpen: true });
    await sock.logout();
    return { loggedOut: true };
}
