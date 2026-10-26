/**
 * Resolve an OIDC access token only for a credential-bound trusted local ingress request.
 *
 * Private root ingress session resolver, disabled unless HYPER_LOCAL_INGRESS is configured. Verifies the actual loopback peer, exact backend and public origins, credential, canonical safe path and server-side OIDC session. Returns secret JSON exclusively to root; root must authorize through CP and never forward the token to browsers.
 * @param opts.req Private POST request from the root ingress with original cookie and exact target metadata.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Private POST request from the root ingress with original cookie and exact target metadata. */
        req: Request;
    },
): Promise<Response> {
    const headers = { "cache-control": "no-store", "pragma": "no-cache" };
    const deny = (status: number) => new Response(null, { status, headers });
    if (!ctx.env.HYPER_LOCAL_INGRESS) return deny(404);
    try {
        const cfg = JSON.parse(ctx.env.HYPER_LOCAL_INGRESS);
        const target = new URL(cfg.target);
        const origin = new URL(cfg.origin);
        if (typeof cfg.credential !== "string" || cfg.credential.length < 32 || !/^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(cfg.service) || target.origin !== cfg.target || !["http:", "https:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || origin.origin !== cfg.origin || origin.protocol !== "https:") return deny(503);
        const req = opts.req;
        const actual = new URL(req.url);
        const transportPeer = (ctx.state as any).httpTransportPeers?.get(req);
    const peer = transportPeer ?? (ctx.state as any)?.procs?.http?.server?.server?.requestIP?.(req)?.address;
        if (req.method !== "POST" || actual.pathname !== "/auth/local-ingress/session" || actual.search || actual.origin !== cfg.target || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) return deny(403);
        // Compare fixed-length digests rather than a variable-time secret string comparison.
        const supplied = new Bun.CryptoHasher("sha256").update(req.headers.get("authorization") ?? "").digest();
        const expected = new Bun.CryptoHasher("sha256").update("Bearer " + cfg.credential).digest();
        const { timingSafeEqual } = await import("node:crypto");
        if (!timingSafeEqual(supplied, expected)) return deny(403);
        // Browser metadata and forwarded identity are never valid on this private root-to-Hyper channel.
        if ([...req.headers.keys()].some(k => k === "origin" || k === "forwarded" || k === "x-real-ip" || k.startsWith("x-forwarded-") && !(transportPeer && ["x-forwarded-for", "x-forwarded-proto"].includes(k)) || k.startsWith("x-hn-") || k.startsWith("sec-fetch-"))) return deny(403);
        if (!req.headers.get("content-type")?.startsWith("application/json")) return deny(403);
        const text = await req.text();
        if (text.length > 8192) return deny(403);
        const body = JSON.parse(text);
        if (!body || Object.keys(body).sort().join(",") !== "host,method,path,proto,service,target" || body.service !== cfg.service || body.target !== cfg.target || body.host !== origin.host || body.proto !== "https" || typeof body.method !== "string" || !/^[A-Z]+$/.test(body.method) || typeof body.path !== "string") return deny(403);
        const path = body.path.split("?")[0];
        if (!path.startsWith("/") || /[%\\\x00-\x20#]/.test(path) || path.includes("//") || path.split("/").some((p: string) => p === "." || p === "..") || /[\x00-\x1f\x7f#]/.test(body.path)) return deny(403);
        const blocked = ["/procs", "/external", "/node", "/jobs/eval", "/auth/setup", "/auth/local-ingress", "/sidebar/api", "/sidebar/approve"];
        // Exact read-only UI paths remain session-authorized; never exempt all /procs.
        const uiRead = (["GET", "HEAD"].includes(body.method) && ["/procs/ui/htmx.js", "/procs/styles/app.css", "/procs/events/client.js"].includes(path)) || (body.method === "GET" && path === "/procs/events");
        if (!uiRead && blocked.some(prefix => path === prefix || path.startsWith(prefix + "/"))) return deny(403);
        // No bootstrap bypass here: ingress permits only exact GET OIDC start/callback directly.
        const sessionReq = new Request(cfg.origin + body.path, { headers: { cookie: req.headers.get("cookie") ?? "" } });
        const trusted: WeakSet<Request> = ((ctx.state as any).authLocalIngressRequests ??= new WeakSet());
        trusted.add(sessionReq);
        try {
            const result = await ctx.fns.auth.oidcSession({ action: "resolve", req: sessionReq, includeAccessToken: true });
            if (!result.user || !result.accessToken) return Response.json({ setCookie: result.setCookie }, { status: 401, headers });
            return Response.json({ accessToken: result.accessToken, setCookie: result.setCookie }, { headers });
        } finally { trusted.delete(sessionReq); }
    } catch {
        // Never expose exception text, provider responses, cookies or secrets to a caller/log.
        return deny(503);
    }
}
