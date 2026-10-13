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
    const allowEval = (await ctx.fns.settings.get({ module: "vegalite", scopeType: "global", key: "allowEval" })) === true;
    return "charts from a Vega-Lite JSON spec: bar, line, area, point, arc, layered and faceted; data is inline `values`"
        + ", a local CSV/JSON/NDJSON file as `data: { url }`"
        + (sql ? ", or `data: { sql }` run through DuckDB" : "")
        + (allowEval ? "; `vega-lite eval` accepts a JavaScript object expression with await and ctx (e.g. data.values: await ctx.fns.procs.db.select({sql, params})); trusted read-only code only; executes again on render" : "")
        + "; info string takes width=, height=, theme=off; static SVG, so no tooltips or zoom";
};

/**
 * Renders a ```vega-lite fence as a static inline SVG chart.
 * Explicit `eval` mode evaluates a trusted async JavaScript object expression with
 * ctx and session before rendering. Requires vegalite.allowEval; not a sandbox.
 * Evaluation happens on every render: never use mutations or untrusted source.
 * @param opts.source JSON spec, or a JavaScript object expression in eval mode.
 * @param opts.lang Fence language identifier supplied by the Markdown renderer.
 * @param opts.info Fence flags: `eval`, `width=`, `height=` and `theme=off`.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const flags = new Map<string, string>();
    for (const match of String(opts.info ?? "").matchAll(/([a-z]+)=([\w.-]+)/gi)) flags.set(match[1]!.toLowerCase(), match[2]!);
    const num = (key: string) => {
        const value = Number(flags.get(key));
        return Number.isFinite(value) ? value : undefined;
    };
    const theme = flags.get("theme");
    let spec: string | Record<string, unknown> = opts.source;
    if (String(opts.info ?? "").split(/\s+/).includes("eval")) {
        const enabled = await ctx.fns.settings.get({ module: "vegalite", scopeType: "global", key: "allowEval" });
        if (enabled !== true) throw new Error("vegalite: eval requires vegalite.allowEval; enable only for trusted Markdown");
        // Deliberately full server-side JavaScript, not a sandbox. Explicit opt-in
        // keeps ordinary JSON fences and untrusted documents non-executable by default.
        const evaluate = new Function("ctx", "session", '"use strict"; return (async () => (\n' + opts.source + '\n))();');
        const value = await evaluate(ctx, _session);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("vegalite: eval must return a Vega-Lite spec object");
        }
        spec = value;
    }
    const { html } = await ctx.fns.vegalite.render({
        spec,
        width: num("width"),
        height: num("height"),
        theme: theme === "off" || theme === "false" ? false : undefined,
    });
    return html;
}
