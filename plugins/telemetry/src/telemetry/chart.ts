// Charts for the dashboard. Vega-Lite is optional at runtime: if the plugin is
// not mounted the caller still gets a readable inline SVG from the shared
// sparkline, because a performance page that fails to render is worthless.
/**
 * Render a time series from span buckets as an inline chart.
 *
 * Draws volume as a soft area with an overlaid latency line when `p95` values
 * are supplied. Falls back to a plain sparkline when Vega-Lite is unavailable.
 *
 * @param opts.points Time buckets in chronological order.
 * @param opts.kind Which measure to draw. @default "count"
 * @param opts.height Chart height in pixels. @default 150 @minimum 60 @maximum 600
 * @param opts.width Chart width in pixels. @default 920 @minimum 200 @maximum 4000
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Time buckets in chronological order. */
    points: Array<{ bucket: string; count: number; errors: number; p95: number }>;
    /** Which measure to draw. @default "count" */
    kind?: "count" | "latency";
    /** Chart height in pixels. @default 150 @minimum 60 @maximum 600 */
    height?: number;
    /** Chart width in pixels. @default 920 @minimum 200 @maximum 4000 */
    width?: number;
}): Promise<string> {
    const points = opts.points ?? [];
    const kind = opts.kind ?? "count";
    const height = Math.max(60, Math.min(Number(opts.height ?? 150), 600));
    const width = Math.max(200, Math.min(Number(opts.width ?? 920), 4000));
    if (points.length < 2) {
        return `<div class="flex h-[${height}px] items-center justify-center text-2xs text-faint">not enough data in this window</div>`;
    }

    const vega: any = (ctx.fns as any).vegalite;
    if (typeof vega?.render !== "function") {
        const values = points.map(point => (kind === "latency" ? point.p95 : point.count));
        return ctx.fns.procs.ui.sparkline({ values, tone: kind === "latency" ? "warning" : "info", class: "h-24 w-full" });
    }

    const field = kind === "latency" ? "p95" : "count";
    const title = kind === "latency" ? "p95, ms" : "spans";
    const colour = kind === "latency" ? "#E4BE6F" : "#7DA1EF";
    const values = points.map(point => ({ bucket: point.bucket, count: point.count, errors: point.errors, p95: point.p95 }));
    // Few enough labels to read: a 24h window at 30-minute buckets is 48 ticks,
    // which overlap into a grey smear unless thinned out.
    const every = Math.max(1, Math.ceil(points.length / 8));
    const labels = points.filter((_, index) => index % every === 0).map(point => point.bucket);

    // A static SVG has no container to measure, so the width is explicit and the
    // wrapper scales the result down on narrow screens.
    const spec = {
        width,
        height,
        data: { values },
        encoding: {
            x: {
                field: "bucket", type: "ordinal", title: null,
                axis: { values: labels, labelAngle: 0, grid: false, labelOverlap: "greedy" },
            },
        },
        layer: [
            {
                mark: { type: "area", interpolate: "monotone", opacity: 0.18, color: colour },
                encoding: { y: { field, type: "quantitative", title, axis: { grid: true, tickCount: 4 } } },
            },
            {
                mark: { type: "line", interpolate: "monotone", strokeWidth: 2, color: colour },
                encoding: { y: { field, type: "quantitative" } },
            },
            {
                transform: [{ filter: "datum.errors > 0" }],
                mark: { type: "point", filled: true, size: 36, color: "#F58685" },
                encoding: { y: { field, type: "quantitative" } },
            },
        ],
    };

    try {
        const rendered = await vega.render({ spec, width, height });
        // Vega emits fixed width/height attributes. A dashboard column is fluid,
        // so the viewBox does the scaling and the element itself is told to fill
        // its parent inline — an arbitrary Tailwind variant would have to exist
        // in the compiled stylesheet, and a chart must not depend on that.
        const fluid = rendered.html.replace(
            /<svg\b([^>]*?)>/,
            (_match: string, attrs: string) => `<svg${attrs.replace(/\s(?:width|height)="[^"]*"/g, "")} style="width:100%;height:auto;display:block">`,
        );
        return `<div class="w-full">${fluid}</div>`;
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "telemetry.chart.failed", msg: String(error?.message ?? error) });
        const values2 = points.map(point => (kind === "latency" ? point.p95 : point.count));
        return ctx.fns.procs.ui.sparkline({ values: values2, tone: kind === "latency" ? "warning" : "info", class: "h-24 w-full" });
    }
}
