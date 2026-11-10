/**
 * Rejects unlisted HTTP hosts, cross-origin browser requests and nonlocal first-user setup.
 *
 * Call before redirects, authentication or route exemptions. Origin validation applies even without a password. Host allowlisting is opt-in through http.checkAllowedHosts (default false); DNS rebinding protection is absent when disabled. Requests without Origin remain available to CLI clients unless Fetch Metadata identifies cross-site traffic; older browsers omitting both headers retain a CSRF risk. Setup requires a proven loopback TCP peer and no forwarding headers.
 * @param opts.req Incoming HTTP request to validate before dispatch.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming HTTP request to validate before dispatch. */
        req: Request;
    },
): Promise<Response | undefined> {
    const req = opts.req;
    const target = new URL(req.url);
    const deny = (error: string) => Response.json({ error }, { status: 403 });
    const checkHosts = await ctx.fns.settings.get({ module: "http", scopeType: "global", key: "checkAllowedHosts" }) === true;
    const configured = await ctx.fns.settings.get({ module: "http", scopeType: "global", key: "allowedHosts" });
    const allowed = Array.isArray(configured) ? configured : ["localhost", "127.0.0.1", "[::1]"];
    const parseHost = (value: string | null): string | null => {
        if (!value || /[\s/@?#\\,]/.test(value)) return null;
        try {
            const parsed = new URL("http://" + value);
            if (parsed.host.toLowerCase() !== value.toLowerCase().replace(/:80$/, "") || parsed.pathname !== "/") return null;
            return parsed.hostname.toLowerCase();
        } catch { return null; }
    };
    const listed = (value: string | null) => {
        const hostname = parseHost(value);
        return hostname !== null && allowed.some(h => typeof h === "string" && h.toLowerCase() === hostname);
    };
    if (checkHosts && (!listed(req.headers.get("host")) || !listed(target.host))) return deny("untrusted_host");
    const forwardedHost = req.headers.get("x-forwarded-host");
    if (checkHosts && forwardedHost !== null && !listed(forwardedHost)) return deny("untrusted_host");
    if ("/" + target.pathname.split("/").filter(Boolean).join("/") === "/auth/setup") {
        let peer: string | undefined;
        try { peer = (ctx.state as any)?.procs?.http?.server?.server?.requestIP?.(req)?.address; }
        catch { return deny("setup_local_only"); }
        const forwarded = [...req.headers.keys()].some(k => k === "forwarded" || k.startsWith("x-forwarded-") || k === "x-real-ip");
        if (forwarded || !peer || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) return deny("setup_local_only");
    }
    const origin = req.headers.get("origin");
    if (origin !== null) {
        let parsed: URL;
        try { parsed = new URL(origin); } catch { return deny("cross_origin"); }
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || (checkHosts && !listed(parsed.host))) return deny("cross_origin");
        const expected = await ctx.fns.http.publicOrigin({ req });
        if (parsed.origin !== expected) return deny("cross_origin");
    }
    if (req.headers.get("sec-fetch-site") === "cross-site" && (origin !== null || !["GET", "HEAD"].includes(req.method) || req.headers.get("upgrade")?.toLowerCase() === "websocket")) return deny("cross_origin");
    const browserWrite = !["GET", "HEAD"].includes(req.method) || req.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (origin === null && browserWrite) {
        if (req.headers.has("sec-fetch-site")) return deny("cross_origin");
        const referer = req.headers.get("referer");
        if (referer !== null) {
            try {
                if (new URL(referer).origin !== await ctx.fns.http.publicOrigin({ req })) return deny("cross_origin");
            } catch { return deny("cross_origin"); }
        }
    }
    return undefined;
}
