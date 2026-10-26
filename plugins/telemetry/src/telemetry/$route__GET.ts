// The dashboard page. The body is a separate fragment route so the window
// selector and refresh swap only the data, not the chrome.
/**
 * Renders the telemetry dashboard page.
 *
 * @param ctx - Runtime context used to read span statistics and shared UI components.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request whose `hours` query selects the window.
 * @returns The rendered dashboard page.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const w = ctx.fns.w;
    const url = new URL(opts.req.url);
    const hours = Math.max(1, Math.min(Number(url.searchParams.get("hours") ?? 24) || 24, 8760));

    const windows = [
        { label: "1h", value: "1" },
        { label: "6h", value: "6" },
        { label: "24h", value: "24" },
        { label: "7d", value: "168" },
        { label: "30d", value: "720" },
    ].map(item => ({ ...item, action: { href: `/telemetry?hours=${item.value}` } }));

    const fragment = { target: "#telemetry-body", swap: "outerHTML" as const };
    const actions = `${w.segmented({ name: "window", items: windows, value: String(hours) })}
  ${w.button({ label: "Compact", icon: "broom", size: "sm", marks: { action: "maintain" }, title: "Rotate the open page and compact closed pages to parquet", attrs: { "hx-indicator": "#telemetry-body" }, action: { post: `/telemetry/maintain?hours=${hours}`, ...fragment } })}
  ${w.button({ label: "Refresh", icon: "arrows-clockwise", tone: "primary", size: "sm", marks: { action: "refresh" }, attrs: { "hx-indicator": "#telemetry-body" }, action: { get: `/telemetry/body?hours=${hours}`, ...fragment } })}`;

    const body = w.page({
        page: "telemetry",
        title: "Telemetry",
        lead: "Spans from the built-in tracer, paged as NDJSON and compacted to parquet.",
        actions,
        body: await ctx.fns.telemetry.dashboard({ hours }),
    });

    return {
        title: "Telemetry",
        main: body,
    };
}
