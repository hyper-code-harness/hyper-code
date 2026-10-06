// Turn an already-authorised request into a WebSocket for one `$ws_<path>.ts`
// endpoint. The endpoint may refuse (return a Response from `upgrade`) or hand
// back the per-connection data its handlers will find on `ws.data.state`.

/**
 * Upgrades an authorised HTTP request to a WebSocket served by a `$ws_<path>.ts` endpoint.
 *
 * Called by procs.http.handle after middleware. Runs the endpoint's optional `upgrade` hook; a returned
 * Response refuses the socket with that response, any other value becomes `ws.data.state`. Returns
 * undefined once Bun has taken the connection, or an error Response.
 * @param opts.req Request carrying `Upgrade: websocket`.
 * @param opts.server Bun server that received the request.
 * @param opts.endpoint Loaded endpoint module: optional upgrade, open, message, close and drain handlers.
 * @param opts.params Path parameters matched from the endpoint address.
 * @param opts.path Endpoint address pattern, such as `/browser/live/:tab`.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Request carrying `Upgrade: websocket`. */
        req: Request;
        /** Bun server that received the request. */
        server?: any;
        /** Loaded endpoint module: optional upgrade, open, message, close and drain handlers. */
        endpoint: types.procs.http.WsEndpoint;
        /** Path parameters matched from the endpoint address. */
        params: Record<string, string>;
        /** Endpoint address pattern, such as `/browser/live/:tab`. */
        path: string;
    },
): Promise<Response | undefined> {
    const { req, server, endpoint } = opts;
    if (!server?.upgrade) return new Response("WebSocket upgrade is not available on this listener", { status: 426 });
    // Browsers send cookies with a cross-site WebSocket handshake, and the GET-only
    // CSRF rule of the middleware does not cover it: refuse a foreign Origin here.
    const origin = req.headers.get("origin");
    if (origin) {
        const expected = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
        let host = "";
        try { host = new URL(origin).host; } catch { /* malformed origin */ }
        if (host !== expected) return new Response("Cross-origin WebSocket rejected", { status: 403 });
    }
    let state: unknown = undefined;
    if (typeof endpoint.upgrade === "function") {
        const answer = await endpoint.upgrade(ctx, session, { req, params: opts.params });
        if (answer instanceof Response) return answer;
        state = answer;
    }
    const data: types.procs.http.WsData = { endpoint, ctx, session, params: opts.params, path: opts.path, url: req.url, state };
    if (server.upgrade(req, { data })) return undefined;
    return new Response("WebSocket upgrade failed", { status: 400 });
}
