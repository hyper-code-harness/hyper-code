// A second Hyper (a family member's instance on this Mac or on the tailnet) may
// relay Anthropic requests through this one so a single Claude subscription has a
// single token owner — no keychain sharing, no refresh races. The caller proves
// itself with the configured proxy token; the request must come from a private
// address (loopback or Tailscale 100.64/10), never from the open internet.
/**
 * Authorize an incoming LLM proxy request from another Hyper instance
 *
 * Verifies the bearer token against the llm.proxyToken setting and that the
 * request originates from loopback or a Tailscale (CGNAT 100.64.0.0/10) address
 * without forwarding headers. Returns ok or a ready 401/403 response.
 * @param opts.req Incoming proxy request.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming proxy request. */
        req: Request;
    },
): Promise<{ ok: true; client: string } | { ok: false; response: Response }> {
    const expected = (await ctx.fns.settings.getString({ module: "llm", scopeType: "global", key: "proxyToken" }))?.trim();
    if (!expected) return { ok: false, response: Response.json({ error: "llm proxy is disabled" }, { status: 403 }) };
    const forwarded = opts.req.headers.get("x-forwarded-for") ?? opts.req.headers.get("x-forwarded-host");
    const ip = String((ctx.state as any).procs?.http?.server?.server?.requestIP?.(opts.req)?.address ?? "").replace(/^::ffff:/, "");
    const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
    const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
    if (forwarded || !(loopback || tailscale)) return { ok: false, response: Response.json({ error: "llm proxy accepts loopback or tailnet clients only" }, { status: 403 }) };
    const header = opts.req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const a = Buffer.from(token), b = Buffer.from(expected);
    if (!token || a.length !== b.length || !require("node:crypto").timingSafeEqual(a, b)) {
        return { ok: false, response: Response.json({ error: "invalid llm proxy token" }, { status: 401 }) };
    }
    return { ok: true, client: opts.req.headers.get("x-hyper-client")?.slice(0, 64) || ip };
}
