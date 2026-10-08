/**
 * Creates this Hyper's inbox key (once, kept in encrypted local secrets) and binds it on the relay as this node
 * (identity.principal), so mail to <agent id>@<host> reaches this instance. Idempotent. The relay checks that the request
 * comes from this machine's mesh address. Returns the public key and addresses, never the secret key.
 * @param opts.label Device label shown in the directory. @default "hyper"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Device label shown in the directory. @default "hyper" */
    label?: string;
}): Promise<{ npub: string; principal: string; host: string; inbox: string; relay: string }> {
    const c = await ctx.fns.inbox.connection({ create: true });
    const { conn, identity } = c!;
    const r = await ctx.fns.inbox.request({ conn, method: "PUT", path: "/v1/relay/keys", body: { label: opts.label ?? "hyper", as: identity.principal } });
    if (r.status !== 200) throw new Error(`inbox.register: relay refused (${r.status} ${r.body?.error ?? ""}); this machine must be on Hypermesh and enrolled as ${identity.principal}`);
    await ctx.fns.inbox.setState({ key: "registered", value: { npub: conn.npub, principal: r.body.principal, at: Date.now() } });
    return { npub: conn.npub, principal: r.body.principal, host: identity.host, inbox: `inbox@${identity.host}`, relay: identity.relay };
}
