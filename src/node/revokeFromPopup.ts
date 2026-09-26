/**
 * Revoke a client token from the card
 * @param opts.id Client id.
 * @param opts.name Client name for the message.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Client id. */ id: string; /** Client name. */ name?: string }): Promise<string> {
    const r = await ctx.fns.node.revokeClient({ id: opts.id });
    return ctx.fns.ui.popupContent({ title: "Revoke", kind: "login", html: `<p class="text-sm">${r.revoked ? `Revoked ${ctx.fns.procs.ui.escape({ text: String(opts.name ?? opts.id) })}. Its Hyper can no longer relay through you.` : "Nothing to revoke."}</p>` });
}
