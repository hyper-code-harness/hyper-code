// ```svg fences in Markdown (chat answers, docs, notes) render as inline
// drawings. Plain markup by default; ```svg tsx computes the drawing in TSX,
// which requires svg.allowEval. A block that fails stays visible as code.

/**
 * One line in the system prompt's fence index, naming the modes that are open.
 *
 * The `tsx` mode is only mentioned once svg.allowEval is on — advertising code
 * execution while it is switched off would send an agent straight at an error.
 */
export const hint = async (ctx: Context): Promise<string> => {
    const allowEval = (await ctx.fns.settings.get({ module: "svg", scopeType: "global", key: "allowEval" })) === true;
    return "hand-written SVG for a picture with no chart in it — a schema, a timeline, a state board, an annotated shape;"
        + " use when the exact placement, labels and colours matter and mermaid's auto-layout or a Vega-Lite chart does not fit"
        + (allowEval
            ? "; `svg tsx` computes the drawing in TSX with ctx and await (rows.map to elements, `return <svg>…</svg>`); trusted read-only code only, runs again on every render"
            : "")
        + "; info string takes width= and height=; scripts and animation are stripped";
};

/**
 * Renders a ```svg fence as an inline drawing.
 *
 * The body is SVG markup; with `tsx` in the info string it is TSX executed to
 * produce the markup, which requires svg.allowEval and is not sandboxed.
 * @param opts.source SVG markup, or TSX source in `tsx` mode.
 * @param opts.lang Fence language identifier supplied by the Markdown renderer.
 * @param opts.info Fence flags: `tsx`, `width=` and `height=`.
 */
export default async function (ctx: Context, session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const info = String(opts.info ?? "");
    const flags = new Map<string, string>();
    for (const match of info.matchAll(/([a-z]+)=([\w.-]+)/gi)) flags.set(match[1]!.toLowerCase(), match[2]!);
    const num = (key: string) => {
        const value = Number(flags.get(key));
        return Number.isFinite(value) ? value : undefined;
    };

    let markup = opts.source;
    if (info.split(/\s+/).includes("tsx")) {
        const enabled = await ctx.fns.settings.get({ module: "svg", scopeType: "global", key: "allowEval" });
        if (enabled !== true) throw new Error("svg: tsx drawings require svg.allowEval; enable only for trusted Markdown");
        markup = (await ctx.fns.svg.tsx({ source: opts.source })).svg;
    }

    return ctx.fns.svg.render({ svg: markup, width: num("width"), height: num("height") }).html;
}
