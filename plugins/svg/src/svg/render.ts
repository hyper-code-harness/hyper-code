// Markup in, a chat-safe figure out. Everything that makes an SVG behave in a
// page happens here, once, so neither fence nor caller has to remember it:
// sanitize, give the root a namespace, keep its intrinsic size but let the
// stylesheet scale it down inside a narrow column.

/** Pull width/height out of the root tag, whatever form they are written in. */
function intrinsic(svg: string): { width?: number; height?: number; viewBox?: string } {
    const head = svg.slice(0, svg.indexOf(">") + 1);
    const read = (name: string) => {
        const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(head);
        return m?.[1];
    };
    const w = Number.parseFloat(read("width") ?? "");
    const h = Number.parseFloat(read("height") ?? "");
    return { width: Number.isFinite(w) ? w : undefined, height: Number.isFinite(h) ? h : undefined, viewBox: read("viewBox") };
}

/**
 * Turns SVG markup into a sanitized, responsive HTML fragment for a page.
 *
 * Use for a drawing already written as markup — a ```svg fence goes through
 * here, and so does svg.tsx output. Scripting, animation and references to
 * other servers are stripped (see svg.sanitize); a missing `xmlns` is added,
 * without which a browser shows nothing; a drawing with width and height but no
 * `viewBox` gets one, so it scales instead of being clipped. The markup is
 * returned alongside the fragment, so saving it to a file gives the same
 * picture that the page shows.
 * @param opts.svg SVG markup, with or without an XML declaration.
 * @param opts.width Overrides the drawing's width, in pixels. @minimum 16 @maximum 4000
 * @param opts.height Overrides the drawing's height, in pixels. @minimum 16 @maximum 4000
 * @returns The HTML fragment, the cleaned SVG itself, and what sanitizing removed.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** SVG markup, with or without an XML declaration. */
    svg: string;
    /** Overrides the drawing's width, in pixels. @minimum 16 @maximum 4000 */
    width?: number;
    /** Overrides the drawing's height, in pixels. @minimum 16 @maximum 4000 */
    height?: number;
}): { html: string; svg: string; removed: string[] } {
    const { svg: clean, removed } = ctx.fns.svg.sanitize({ svg: opts.svg });
    const size = intrinsic(clean);

    let out = clean;
    // Without a viewBox an explicit width/height is a crop, not a scale: the
    // drawing keeps its pixel size and the stylesheet cannot shrink it.
    if (!size.viewBox && size.width && size.height) {
        out = out.replace(/<svg\b/i, `<svg viewBox="0 0 ${size.width} ${size.height}"`);
    }
    const setSize = (name: "width" | "height", value?: number) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const head = out.slice(0, out.indexOf(">") + 1);
        out = new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`, "i").test(head)
            ? out.replace(new RegExp(`(<svg\\b[^>]*?)\\s${name}\\s*=\\s*"[^"]*"`, "i"), `$1 ${name}="${value}"`)
            : out.replace(/<svg\b/i, `<svg ${name}="${value}"`);
    };
    setSize("width", opts.width);
    setSize("height", opts.height);

    // Layout lives in $style_svg.css, shipped with this plugin.
    return { html: `<div class="svg-figure">${out}</div>`, svg: out, removed };
}
