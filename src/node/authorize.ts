// Another Hyper relays LLM calls through this one (docs/hyper-node.md). The
// caller proves itself with a client token issued by node.issueClient; the
// request must arrive from a private address — loopback or the tailnet — and
// never through a forwarding proxy.
/**
 * Authorize an incoming Hyper-node request and resolve the client record
 *
 * Verifies the bearer token against llm_node_clients (sha256), checks the
 * source address is loopback or Tailscale (100.64.0.0/10) without forwarding
 * headers, enforces the hop limit and bumps usage counters. Returns the client
 * with its provider allow-list, or a ready 401/403 response.
 * @param opts.req Incoming request.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request. */
        req: Request;
    },
): Promise<{ ok: true; client: { id: string; name: string; providers: string[] }; hops: number } | { ok: false; response: Response }> {
    const deny = (status: number, error: string) => ({ ok: false as const, response: Response.json({ error }, { status, headers: { "cache-control": "no-store" } }) });
    const forwarded = opts.req.headers.get("x-forwarded-for") ?? opts.req.headers.get("x-forwarded-host");
    const ip = String((ctx.state as any).procs?.http?.server?.server?.requestIP?.(opts.req)?.address ?? "").replace(/^::ffff:/, "");
    const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
    const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
    if (forwarded || !(loopback || tailscale)) return deny(403, "hyper node accepts loopback or tailnet clients only");
    const hops = Number(opts.req.headers.get("x-hyper-hops") ?? 0);
    if (!Number.isFinite(hops) || hops >= 3) return deny(508, "hyper node hop limit reached");
    const header = opts.req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return deny(401, "hyper node token required");
    const hash = new Bun.CryptoHasher("sha256").update(token).digest("hex");
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, name, providers FROM llm_node_clients WHERE token_hash = ? AND revoked_at IS NULL", params: [hash] }) as any[];
    const row = rows[0];
    if (!row) return deny(401, "invalid or revoked hyper node token");
    await ctx.fns.procs.db.run({ sql: "UPDATE llm_node_clients SET last_used_at = ?, requests = requests + 1 WHERE id = ?", params: [Date.now(), String(row.id)] });
    const providers = String(row.providers ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
    return { ok: true, client: { id: String(row.id), name: String(row.name), providers }, hops };
}
