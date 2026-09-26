/**
 * Redirect a top-level browser page load from plain HTTP to the HTTPS/HTTP2 address
 *
 * Returns a 302 to https://<tailscale-name>:<H2_PORT><same path> for a direct GET
 * navigation of a whole page, and nothing otherwise. Never touches htmx/fetch calls,
 * SSE, iframes (the browser-extension sidebar), the CLI, or tunnel traffic
 * (x-forwarded-*), so every non-browser client keeps working on plain HTTP.
 * Off with HYPER_HTTPS=off or HYPER_HTTPS_REDIRECT=off, and when no trusted
 * (Tailscale) certificate is available.
 * @param opts.req Incoming request as seen by the plain HTTP server.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Incoming request as seen by the plain HTTP server. */
    req: Request;
}): Response | undefined {
    const h2 = (ctx.state as any).h2 as { port?: number; tsName?: string | null; redirect?: boolean } | undefined;
    if (!h2?.tsName || !h2.port || !h2.redirect) return;
    const req = opts.req;
    const url = new URL(req.url);
    if (url.protocol !== "http:" || req.method !== "GET") return;
    const h = req.headers;
    if (h.get("sec-fetch-mode") !== "navigate" || h.get("sec-fetch-dest") !== "document") return;
    if (h.get("x-forwarded-for") || h.get("x-forwarded-host") || h.get("forwarded")) return;
    if (url.pathname.startsWith("/sidebar/") || url.searchParams.get("presentation") === "sidebar" || url.searchParams.get("embed") === "1") return;
    return new Response(null, { status: 302, headers: { location: `https://${h2.tsName}:${h2.port}${url.pathname}${url.search}`, "cache-control": "no-store" } });
}
