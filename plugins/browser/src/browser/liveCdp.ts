// Which Chrome a live-view link may show. A link is a URL anybody signed in can
// edit, so `?cdp=` is honoured only for the configured default and an explicit
// allow-list — never as "connect wherever the query string says".

/**
 * Resolves the Chrome DevTools endpoint a live-view request may use.
 *
 * Without `requested` returns the default: setting browser.liveCdpUrl, then CDP_BROWSER_URL, then
 * http://127.0.0.1:9222. A requested endpoint is accepted only when it equals the default or is listed
 * in setting browser.liveCdpAllow (BROWSER_LIVE_CDP_ALLOW); otherwise this throws.
 * @param opts.requested Endpoint named by a link (`?cdp=`), such as `http://127.0.0.1:9230`.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Endpoint named by a link (`?cdp=`), such as `http://127.0.0.1:9230`. */
        requested?: string;
    } = {},
): Promise<{ browserUrl: string; isDefault: boolean }> {
    const norm = (u: string) => u.trim().replace(/\/+$/, "");
    const configured = await ctx.fns.settings.getString({ module: "browser", scopeType: "global", key: "liveCdpUrl" });
    const fallback = norm(configured || ctx.env.CDP_BROWSER_URL || "http://127.0.0.1:9222");
    const requested = norm(opts.requested ?? "");
    if (!requested || requested === fallback) return { browserUrl: fallback, isDefault: true };
    const allowList = await ctx.fns.settings.getString({ module: "browser", scopeType: "global", key: "liveCdpAllow" });
    const allowed = String(allowList ?? "").split(",").map(norm).filter(Boolean);
    if (!allowed.includes(requested)) throw new Error(`Chrome endpoint ${requested} is not allowed for live view (setting browser.liveCdpAllow)`);
    return { browserUrl: requested, isDefault: false };
}
