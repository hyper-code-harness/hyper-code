// Force a maintenance pass from the dashboard and answer with the refreshed
// body, so the effect on storage is visible immediately.
/**
 * Runs a forced storage maintenance pass and returns the refreshed dashboard body.
 *
 * @param ctx - Runtime context used to rotate, compact and re-render.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request whose `hours` query selects the window to re-render.
 * @returns An HTML fragment response with the updated dashboard body.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const url = new URL(opts.req.url);
    const hours = Math.max(1, Math.min(Number(url.searchParams.get("hours") ?? 24) || 24, 8760));
    const result = await ctx.fns.telemetry.maintain({ force: true });
    ctx.fns.procs.log.info({ event: "telemetry.maintain.manual", msg: `compacted ${result.compacted}`, ...result });
    const html = await ctx.fns.telemetry.dashboard({ hours });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
