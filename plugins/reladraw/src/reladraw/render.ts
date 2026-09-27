import { compile, THEME_NAMES } from "reladraw";

/**
 * Renders reladraw diagram source to a standalone SVG document.
 *
 * Use when a diagram written in the reladraw language — nodes placed relative to
 * one another (`right of`, `below`, `level with`) and edges between them — must
 * become an image, for a file, a message or a page. A source error throws with
 * its line number; call `reladraw.validate` first to get problems as data.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Reladraw source text: one statement per line (`node`, `edge`, `style`, `diagram`, ...). */
        source: string;
        /** Theme applied when the source has no `diagram theme:` line, e.g. `light`, `dark`, `nord`, `print`. */
        theme?: string;
        /** Base text size in pixels. @default 14 @minimum 8 @maximum 32 */
        fontSize?: number;
        /** Blank space around the drawing in pixels. @minimum 0 @maximum 200 */
        margin?: number;
    },
): Promise<types.reladraw.Rendered> {
    let source = String(opts.source ?? "");
    if (!source.trim()) throw new Error("reladraw.render: source is empty");
    if (opts.theme) {
        if (!THEME_NAMES.includes(opts.theme)) throw new Error(`reladraw.render: unknown theme "${opts.theme}" — one of ${THEME_NAMES.join(", ")}`);
        if (!/^\s*diagram\b/m.test(source)) source = `diagram  theme: ${opts.theme}\n` + source;
    }
    const fontSize = opts.fontSize == null ? undefined : Math.max(8, Math.min(32, Number(opts.fontSize)));
    const margin = opts.margin == null ? undefined : Math.max(0, Math.min(200, Number(opts.margin)));
    let svg: string;
    try {
        svg = compile(source, { fontSize, margin });
    } catch (error: any) {
        // A theme line we prepended shifts every line number by one.
        const shift = opts.theme && source !== opts.source ? 1 : 0;
        const line = typeof error?.line === "number" ? Math.max(0, error.line - shift) : 0;
        throw new Error(line ? `reladraw line ${line}: ${error.message}` : `reladraw: ${error?.message ?? error}`);
    }
    const width = Number(/<svg\b[^>]*\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    const height = Number(/<svg\b[^>]*\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 0);
    return { svg, width, height };
}
