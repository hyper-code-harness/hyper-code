// ```vega-lite fences in Markdown (chat answers, docs, notes, SKILL.md pages)
// render as static inline charts through vegalite.render. The fence info string
// may carry options: ```vega-lite width=600 height=300 theme=off
// A block that fails to compile stays visible as code.

/**
 * One line in the system prompt's fence index, naming the data sources that are
 * actually open right now — advertising `data: { sql }` while allowSqlData is
 * off would send the agent at an error.
 */
export const hint = async (ctx: Context): Promise<string> => {
    const sql = (await ctx.fns.settings.get({ module: "vegalite", scopeType: "global", key: "allowSqlData" })) === true;
    return "charts from a Vega-Lite JSON spec: bar, line, area, point, arc, layered and faceted; data is inline `values`"
        + ", a local CSV/JSON/NDJSON file as `data: { url }`"
        + (sql ? ", or `data: { sql }` run through DuckDB" : "")
        + "; info string takes width=, height=, theme=off; static SVG, so no tooltips or zoom";
};

/**
 * Renders a ```vega-lite fence as a static inline SVG chart.
 * @param opts.source JSON Vega-Lite spec inside the fence.
 * @param opts.info Rest of the fence line; `width=`, `height=` and `theme=off` are read from it.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const flags = new Map<string, string>();
    for (const match of String(opts.info ?? "").matchAll(/([a-z]+)=([\w.-]+)/gi)) flags.set(match[1]!.toLowerCase(), match[2]!);
    const num = (key: string) => {
        const value = Number(flags.get(key));
        return Number.isFinite(value) ? value : undefined;
    };
    const theme = flags.get("theme");
    const { html } = await ctx.fns.vegalite.render({
        spec: opts.source,
        width: num("width"),
        height: num("height"),
        theme: theme === "off" || theme === "false" ? false : undefined,
    });
    return html;
}
