// SQL in, picture out. The two halves already exist — DuckDB produces rows,
// vegalite renders a spec — and what is missing between them is the boring
// part: naming the columns, picking a type for each channel and writing the
// spec by hand. This function guesses those from the result's own types and
// lets any of it be overridden.

/**
 * Runs a query and renders the result as a chart in one call.
 *
 * The fastest path from data to a picture: give SQL and the columns for the
 * axes, get back an inline SVG plus the Vega-Lite spec that produced it. Column
 * types come from the query result — text becomes a category, numbers a
 * quantity, dates a time axis — so a bar, line, area, point or arc chart needs
 * no spec by hand. Pass `spec` to merge extra Vega-Lite options over the
 * generated one. Use `duckdb.table` when the answer is better read than seen.
 * @param opts.sql Read-only DuckDB SQL statement producing the chart's rows.
 * @param opts.params Values bound to `?` placeholders.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.mark Chart type. @default bar
 * @param opts.x Column for the x axis. Defaults to the first column.
 * @param opts.y Column for the y axis. Defaults to the first numeric column after x.
 * @param opts.color Column that splits the data into coloured series.
 * @param opts.title Chart title.
 * @param opts.sort Sort categories by value instead of by name. @default false
 * @param opts.width Chart width in pixels. @default 520 @minimum 50 @maximum 4000
 * @param opts.height Chart height in pixels. @default 240 @minimum 50 @maximum 4000
 * @param opts.maxRows Maximum rows drawn. @default 5000 @minimum 1 @maximum 50000
 * @param opts.spec Vega-Lite fields merged over the generated spec, for scales, axes, tooltips and the rest.
 * @returns The SVG and its HTML wrapper, the spec that was rendered, and the rows behind it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Read-only DuckDB SQL statement producing the chart's rows. */
    sql: string;
    /** Values bound to `?` placeholders. */
    params?: unknown[];
    /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
    db?: string;
    /** Chart type. @default bar */
    mark?: "bar" | "line" | "area" | "point" | "arc";
    /** Column for the x axis. Defaults to the first column. */
    x?: string;
    /** Column for the y axis. Defaults to the first numeric column after x. */
    y?: string;
    /** Column that splits the data into coloured series. */
    color?: string;
    /** Chart title. */
    title?: string;
    /** Sort categories by value instead of by name. @default false */
    sort?: boolean;
    /** Chart width in pixels. @default 520 @minimum 50 @maximum 4000 */
    width?: number;
    /** Chart height in pixels. @default 240 @minimum 50 @maximum 4000 */
    height?: number;
    /** Maximum rows drawn. @default 5000 @minimum 1 @maximum 50000 */
    maxRows?: number;
    /** Vega-Lite fields merged over the generated spec, for scales, axes, tooltips and the rest. */
    spec?: Record<string, unknown>;
}): Promise<{ html: string; svg: string; spec: Record<string, unknown>; rows: any[]; rowCount: number; truncated: boolean }> {
    if (!(ctx.fns as any).vegalite) throw new Error("duckdb.chart: the vegalite plugin is not mounted; enable it or use duckdb.table");
    const maxRows = Math.max(1, Math.min(Number(opts.maxRows ?? 5000), 50_000));
    const result = await ctx.fns.duckdb.query({ sql: opts.sql, params: opts.params, db: opts.db, maxRows });
    if (!result.rows.length) throw new Error("duckdb.chart: the query returned no rows");

    const columns = [...new Set(result.rows.flatMap(row => Object.keys(row as Record<string, unknown>)))];
    const typeOf = (column: string): "quantitative" | "temporal" | "nominal" => {
        const values = result.rows.map(row => (row as Record<string, unknown>)[column]).filter(value => value !== null && value !== undefined);
        if (values.length && values.every(value => typeof value === "number")) return "quantitative";
        // normalize turns every DuckDB date and timestamp into an ISO string.
        if (values.length && values.every(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value))) return "temporal";
        return "nominal";
    };

    const x = opts.x ?? columns[0];
    if (!x || !columns.includes(x)) throw new Error(`duckdb.chart: no x column; the query returned ${columns.join(", ") || "nothing"}`);
    const y = opts.y ?? columns.find(column => column !== x && typeOf(column) === "quantitative");
    if (!y) throw new Error(`duckdb.chart: no numeric column to plot; the query returned ${columns.join(", ")}`);
    if (!columns.includes(y)) throw new Error(`duckdb.chart: column ${y} is not in the result (${columns.join(", ")})`);
    if (opts.color && !columns.includes(opts.color)) throw new Error(`duckdb.chart: column ${opts.color} is not in the result (${columns.join(", ")})`);

    const mark = opts.mark ?? "bar";
    const xType = typeOf(x);
    // A horizontal bar chart is the readable default for long category names,
    // and categories are exactly where the sort option is meaningful.
    const sortCategories = opts.sort ? { sort: ("-" + (mark === "arc" ? "theta" : "y")) as string } : {};
    const encoding: Record<string, unknown> = mark === "arc"
        ? { theta: { field: y, type: "quantitative" }, color: { field: opts.color ?? x, type: "nominal" } }
        : {
            x: { field: x, type: xType, ...(xType === "nominal" ? { axis: { labelAngle: 0 }, ...sortCategories } : {}) },
            y: { field: y, type: "quantitative" },
            ...(opts.color ? { color: { field: opts.color, type: typeOf(opts.color) } } : {}),
        };

    const spec: Record<string, unknown> = {
        ...(opts.title ? { title: opts.title } : {}),
        data: { values: result.rows },
        mark: mark === "point" ? { type: "point", filled: true } : mark,
        encoding,
        ...(opts.spec ?? {}),
    };
    const rendered = await ctx.fns.vegalite.render({ spec, width: opts.width ?? 520, height: opts.height ?? 240 });
    return { html: rendered.html, svg: rendered.svg, spec, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated };
}
