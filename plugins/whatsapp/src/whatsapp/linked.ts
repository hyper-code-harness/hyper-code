/**
 * Watch predicate: reports ready once the WhatsApp linked device is connected.
 *
 * Use with agent.watch({ predicate: "runtime.fn", opts: { name: "whatsapp.linked" } }) to wake an agent after the
 * person scans the QR code from whatsapp.login.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ ready: boolean; result?: { id: string; name?: string } }> {
    const c = await ctx.fns.whatsapp.client({ waitMs: 3000 });
    return c.status === "open" && c.me ? { ready: true, result: c.me } : { ready: false };
}
