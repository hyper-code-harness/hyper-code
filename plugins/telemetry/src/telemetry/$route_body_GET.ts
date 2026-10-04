// Just the data part of the dashboard, for HTMX swaps and for polling.
/**
 * Renders the telemetry dashboard body fragment.
 *
 * @param ctx - Runtime context used to read span statistics.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request whose `hours` and `limit` queries shape the result.
 * @returns An HTML fragment response.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const url = new URL(opts.req.url);
    const hours = Math.max(1, Math.min(Number(url.searchParams.get("hours") ?? 24) || 24, 8760));
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 10) || 10, 100));
    const html = await ctx.fns.telemetry.dashboard({ hours, limit });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
