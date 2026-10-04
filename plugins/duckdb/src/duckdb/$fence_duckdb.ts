// ```duckdb fences let a document carry the query that made its table or
// chart, instead of a pasted result nobody can re-check. The SQL runs when the
// Markdown is rendered, which is exactly why it is off until someone turns it
// on: DuckDB reads any file the server can.

/**
 * Renders a ```duckdb fence by running its SQL and showing the result as a table or a chart.
 *
 * The fence body is read-only SQL; the info string chooses the output —
 * `chart=bar` (or line, area, point, arc) with `x=`, `y=`, `color=`, `title=`,
 * `width=`, `height=`, and `rows=` for a table. Disabled unless
 * `duckdb.allowFence` is on, because rendering a document would otherwise run
 * its queries. A failing block stays visible as code.
 * @param opts.source SQL inside the fence.
 * @param opts.info Rest of the fence line, carrying the output options.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const allowed = (await ctx.fns.settings.get({ module: "duckdb", scopeType: "global", key: "allowFence" })) === true;
    if (!allowed) throw new Error("duckdb: ```duckdb fences are disabled (enable duckdb.allowFence to run them)");

    const flags = new Map<string, string>();
    for (const match of String(opts.info ?? "").matchAll(/([a-z]+)=("[^"]*"|[\w.%+-]+)/gi)) {
        flags.set(match[1]!.toLowerCase(), match[2]!.replace(/^"|"$/g, ""));
    }
    const num = (key: string) => {
        const value = Number(flags.get(key));
        return Number.isFinite(value) ? value : undefined;
    };

    const chart = flags.get("chart");
    if (chart) {
        const { html } = await ctx.fns.duckdb.chart({
            sql: opts.source,
            mark: chart as any,
            x: flags.get("x"),
            y: flags.get("y"),
            color: flags.get("color"),
            title: flags.get("title"),
            sort: flags.get("sort") === "true" || flags.get("sort") === "value",
            width: num("width"),
            height: num("height"),
        });
        return html;
    }

    const { markdown } = await ctx.fns.duckdb.table({ sql: opts.source, maxRows: num("rows") });
    return await ctx.fns.markdown.render({ source: markdown });
}
