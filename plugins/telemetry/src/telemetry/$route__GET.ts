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
    const ui = ctx.fns.procs.ui;
    const url = new URL(opts.req.url);
    const hours = Math.max(1, Math.min(Number(url.searchParams.get("hours") ?? 24) || 24, 8760));

    const windows = [
        { label: "1h", value: "1" },
        { label: "6h", value: "6" },
        { label: "24h", value: "24" },
        { label: "7d", value: "168" },
        { label: "30d", value: "720" },
    ].map(item => ({ ...item, href: `/telemetry?hours=${item.value}` }));

    const actions = `<div class="flex shrink-0 flex-wrap items-center gap-2">
  ${ui.segmented({ items: windows, value: String(hours) })}
  ${ui.button({ action: "maintain", html: '<i class="ph ph-broom"></i>Compact', tone: "default", size: "sm", title: "Rotate the open page and compact closed pages to parquet", attrs: { "hx-post": `/telemetry/maintain?hours=${hours}`, "hx-target": "#telemetry-body", "hx-swap": "outerHTML", "hx-indicator": "#telemetry-body" } })}
  ${ui.button({ action: "refresh", html: '<i class="ph ph-arrows-clockwise"></i>Refresh', tone: "primary", size: "sm", attrs: { "hx-get": `/telemetry/body?hours=${hours}`, "hx-target": "#telemetry-body", "hx-swap": "outerHTML", "hx-indicator": "#telemetry-body" } })}
</div>`;

    // The shared page shell carries no padding of its own, so the dashboard owns
    // its container: a readable measure, real gutters, and breathing room at the
    // top — without them every card sits flush against the window frame.
    const body = `<div class="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-6">
  <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight">Telemetry</h1>
      <p class="mt-1 text-sm text-subtle">Spans from the built-in tracer, paged as NDJSON and compacted to parquet.</p>
    </div>
    ${actions}
  </header>
  ${await ctx.fns.telemetry.dashboard({ hours })}
</div>`;

    return {
        title: "Telemetry",
        main: ui.page({ page: "telemetry", main: body }),
    };
}
