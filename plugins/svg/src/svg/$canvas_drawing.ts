// A drawing tab on the canvas (kind svg.drawing): plain SVG markup, or TSX computed on the server with ctx —
// the same two modes as the ```svg fence. TSX runs again every time the tab is shown, so a drawing over
// live data is current when it is opened or switched to.

export const hint = async (ctx: Context): Promise<string> => {
    const allowEval = (await ctx.fns.settings.get({ module: "svg", scopeType: "global", key: "allowEval" })) === true;
    return "a drawing — args `{ svg }` with SVG markup"
        + (allowEval ? ", or `{ tsx }`: TSX computed on the server with ctx and await (`return <svg viewBox=…>…</svg>`), run again each time the tab is shown — for diagrams and boards over live data; trusted read-only code only" : "")
        + "; give the root a viewBox, the tab scales it to fit; scripts and animation are stripped";
};

const MAX = 200_000;

export default {
    icon: "pencil-simple-line",
    live: (item: types.canvas.Item) => !!item.args.tsx,
    async prepare(ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const svg = typeof opts.args.svg === "string" ? opts.args.svg.trim() : "";
        const tsx = typeof opts.args.tsx === "string" ? opts.args.tsx.trim() : "";
        if (!svg === !tsx) throw new Error("canvas svg.drawing: pass exactly one of args.svg (markup) or args.tsx (TSX source)");
        if ((svg || tsx).length > MAX) throw new Error(`canvas svg.drawing: source is limited to ${MAX / 1000} KB — put big data in a file or table and read it from tsx`);
        if (tsx) {
            const enabled = await ctx.fns.settings.get({ module: "svg", scopeType: "global", key: "allowEval" });
            if (enabled !== true) throw new Error("canvas svg.drawing: tsx drawings require svg.allowEval");
            // Fail now, in the agent's turn, rather than as an error box nobody reads.
            await ctx.fns.svg.tsx({ source: tsx });
            return { args: { tsx }, title: "Drawing" };
        }
        if (!/<svg\b/i.test(svg)) throw new Error("canvas svg.drawing: args.svg must contain an <svg> element");
        return { args: { svg }, title: "Drawing" };
    },
    async render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const esc = (text: string) => ctx.fns.w.escape({ text });
        try {
            let markup = String(opts.item.args.svg ?? "");
            if (opts.item.args.tsx) {
                const enabled = await ctx.fns.settings.get({ module: "svg", scopeType: "global", key: "allowEval" });
                if (enabled !== true) throw new Error("tsx drawings require svg.allowEval");
                markup = (await ctx.fns.svg.tsx({ source: String(opts.item.args.tsx) })).svg;
            }
            const { html } = ctx.fns.svg.render({ svg: markup });
            return `<div class="h-full overflow-auto bg-base-100 p-6" data-svg-canvas>${html}</div>`;
        } catch (error: any) {
            return `<div class="h-full overflow-auto p-6 text-sm"><p class="mb-3 text-error">${esc(String(error?.message ?? error))}</p>`
                + `<pre class="whitespace-pre-wrap text-xs text-faint">${esc(String(opts.item.args.tsx ?? opts.item.args.svg ?? ""))}</pre></div>`;
        }
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const a = opts.item.args;
        const lines = String(a.tsx ?? a.svg ?? "").split("\n").length;
        return `svg drawing (${a.tsx ? "tsx, recomputed on show" : "markup"}, ${lines} lines)`;
    },
} satisfies types.canvas.Kind;
