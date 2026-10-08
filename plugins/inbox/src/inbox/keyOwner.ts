const TTL_MS = 5 * 60_000;
/**
 * Finds whose key this is in the relay directory (reverse lookup), to check the real sender of a received message.
 * Cached per connection for five minutes. Returns null when the key is unknown, revoked or its device is disabled.
 * @param opts.conn Relay connection.
 * @param opts.npub Public key, 64 hex characters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Relay connection. */
    conn: types.inbox.Conn;
    /** Public key, 64 hex characters. */
    npub: string;
}): Promise<{ npub: string; principal: string; device: string; label: string | null; createdAt: number } | null> {
    if (!/^[a-f0-9]{64}$/.test(opts.npub)) return null;
    const cache = (opts.conn.cache ??= new Map());
    const key = "npub:" + opts.npub; const hit = cache.get(key) as { at: number; v: any } | undefined;
    if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
    const r = await ctx.fns.inbox.request({ conn: opts.conn, method: "GET", path: `/v1/relay/keys?npub=${opts.npub}` });
    if (r.status !== 200 && r.status !== 404) throw new Error(`inbox.keyOwner: ${r.status} ${r.body?.error ?? ""}`);
    const v = r.status === 200 ? r.body : null;
    cache.set(key, { at: Date.now(), v });
    return v;
}
