const TTL_MS = 5 * 60_000;
/**
 * Resolves an inbox address through the relay directory: a person's work email or <local>@<published Hyper host>, to its principal
 * and active device keys. Cached per connection for five minutes. Returns null for an unknown address.
 * @param opts.conn Relay connection.
 * @param opts.addr Address such as roman@health-samurai.io or reviewer@hyper.hr.in.hn.hyper-mesh.xyz.
 * @param opts.fresh Bypass the cache. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Relay connection. */
    conn: types.inbox.Conn;
    /** Address such as roman@health-samurai.io or reviewer@hyper.hr.in.hn.hyper-mesh.xyz. */
    addr: string;
    /** Bypass the cache. @default false */
    fresh?: boolean;
}): Promise<types.inbox.Address | null> {
    const cache = (opts.conn.cache ??= new Map());
    const key = "addr:" + opts.addr.trim().toLowerCase();
    const hit = cache.get(key) as { at: number; v: types.inbox.Address | null } | undefined;
    if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.v;
    const r = await ctx.fns.inbox.request({ conn: opts.conn, method: "GET", path: `/v1/relay/keys?addr=${encodeURIComponent(opts.addr.trim())}` });
    if (r.status !== 200 && r.status !== 404) throw new Error(`inbox.lookup ${opts.addr}: ${r.status} ${r.body?.error ?? ""}`);
    const v = r.status === 200 ? r.body as types.inbox.Address : null;
    cache.set(key, { at: Date.now(), v });
    return v;
}
