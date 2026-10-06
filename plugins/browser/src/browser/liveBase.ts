// Where a human reaches this Hyper. A link is read on another device as often
// as on this Mac, so a reachable HTTPS tailnet name wins over localhost — but
// only when the HTTPS listener is not bound to loopback (H2_HOST=127.0.0.1
// means the tailnet name answers nothing, and the link would be dead).

/**
 * Returns the base URL (scheme, host, port; no trailing slash) under which people reach this Hyper.
 *
 * Order: BROWSER_LIVE_BASE_URL (set it to the public address when Hyper sits behind a proxy such as
 * Hyperlet), then the HTTPS tailnet address of the h2 listener when it listens beyond loopback, then
 * http://localhost:<http port>. Used to build live-view links.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}): Promise<string> {
    if (ctx.env.BROWSER_LIVE_BASE_URL) return String(ctx.env.BROWSER_LIVE_BASE_URL).replace(/\/+$/, "");
    const h2 = (ctx.state as any).h2 as { tsName?: string | null; port?: number } | undefined;
    const h2Host = String((ctx.fns.procs.config.resolve({ module: "h2" }) as { host?: string }).host ?? "0.0.0.0");
    const loopback = /^(127\.|::1$|localhost$)/.test(h2Host);
    if (h2?.tsName && h2.port && !loopback) return `https://${h2.tsName}:${h2.port}`;
    const port = (ctx.state.procs.http.server as { port?: number } | undefined)?.port ?? 3000;
    return `http://localhost:${port}`;
}
