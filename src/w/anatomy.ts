/**
 * Lists which smaller widgets and which design tokens a w.* widget is built from
 *
 * Reads the widget's source in src/w and the shared stylesheet: returns the w.* widgets it calls, the w- classes it emits that the stylesheet styles, and every --w-* token those rules read, grouped as colour, type, space, size and shape; the state colours a toned widget reads through --w-tone are shown as one word, tone. Use it to show a widget's anatomy (for example in the gallery) or to check which tokens a change would touch.
 * @param opts.name Widget name without the w. prefix, e.g. "card" or "listRow".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Widget name without the w. prefix, e.g. "card" or "listRow". */
        name: string;
    },
): Promise<{ name: string; widgets: string[]; classes: string[]; tokens: Record<string, string[]> }> {
    const root = String((ctx.state as any).root ?? process.cwd());
        const read = async (rel: string) => { const f = Bun.file(root + "/src/w/" + rel); return (await f.exists()) ? await f.text() : ""; };
        const src = await read(opts.name + ".ts");
        if (!src) return { name: opts.name, widgets: [], classes: [], tokens: {} };
        const css = await read("$style_w.css");
        const widgets = [...new Set([...src.matchAll(/ctx\.fns\.w\.([a-zA-Z]+)/g)].map(m => m[1]!))].filter(n => !["actionAttrs", "safeUrl", "mix"].includes(n) && n !== opts.name).sort();
        const classes = [...new Set([...src.matchAll(/\b(w-[a-z][a-z0-9-]*)/g)].map(m => m[1]!))].filter(c => new RegExp("\\." + c + "(?![a-z0-9-])").test(css));
        const used = new Set<string>();
        const rules = css.slice(css.indexOf("/* sizes and type"));
        for (const m of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const sel = m[1]!;
            if (!classes.some(c => new RegExp("\\." + c + "(?![a-z0-9-])").test(sel))) continue;
            for (const v of m[2]!.matchAll(/var\((--w-[a-z0-9-]+)\)/g)) used.add(v[1]!.slice(4));
            if (/data-tone/.test(sel) || /var\(--w-tone\)/.test(m[2]!)) used.add("tone");
        }
        // A toned widget reads every state colour through --w-tone; show that as one word, not five colours.
        if (used.has("tone")) for (const c of ["live", "success", "warning", "danger", "super"]) used.delete(c);
        const group = (t: string): string =>
            /^(surface-|hover$|border$|border-control$|ink|on-ink$|selected$|focus$|live$|link$|super$|success$|warning$|danger$|backdrop$|tone$)/.test(t) ? "colour"
            : /^(text-|line-|mono$|caps-)/.test(t) ? "type"
            : /^(s\d|gap-)/.test(t) ? "space"
            : /^(control|row$|header$|rail$|icon|dot|mark$)/.test(t) ? "size"
            : /^(radius|shadow|rule|focus-width)/.test(t) ? "shape" : "other";
        const tokens: Record<string, string[]> = {};
        for (const t of [...used].sort()) (tokens[group(t)] ??= []).push(t);
        return { name: opts.name, widgets, classes, tokens };
}
