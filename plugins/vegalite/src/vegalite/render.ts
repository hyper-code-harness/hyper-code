import * as vega from "vega";
import { compile } from "vega-lite";

// Vega resolves `data: { url }` through its loader while the view renders.
// vegalite.inlineData has already replaced every url with rows, so by the time
// we get here nothing legitimate needs loading — a loader call means a url we
// did not see, and the honest answer is to fail instead of fetching it.
function blockingLoader() {
    const refuse = async (uri?: string) => { throw new Error(`vegalite: unexpected data load during render${uri ? `: ${uri}` : ""}`); };
    return { load: refuse, sanitize: refuse, http: refuse, file: refuse } as any;
}

function responsive(svg: string): string {
    // Keep the intrinsic width and height as attributes, so the chart has a
    // natural size, and let the stylesheet scale it down inside a narrow column.
    return svg
        .replace(/^<\?xml[^>]*>\s*/, "")
        .replace(/<svg\b([^>]*?)\swidth="([^"]+)"\sheight="([^"]+)"/, (_m, head, w, h) =>
            `<svg${head} width="${w}" height="${h}" preserveAspectRatio="xMinYMin meet"`);
}

/**
 * Renders a Vega-Lite spec to a static inline SVG HTML fragment.
 *
 * Use to turn a chart spec into markup for a chat answer, a document or a page;
 * ```vega-lite fences in Markdown go through this function automatically. Data
 * may be inline `values` or a `url` pointing at a CSV/TSV/JSON/NDJSON file
 * under the configured data root — urls are resolved before rendering, so no
 * request leaves this server unless `vegalite.allowRemoteData` is on. The host
 * font and palette are applied unless the spec overrides them. There is no
 * interactivity: selections and tooltips are dropped by the static renderer. An
 * invalid spec throws with the Vega-Lite error.
 * @param opts.spec Vega-Lite spec as a parsed object or a JSON string.
 * @param opts.width Overrides the spec's width, in pixels. @minimum 50 @maximum 4000
 * @param opts.height Overrides the spec's height, in pixels. @minimum 50 @maximum 4000
 * @param opts.theme Apply the host UI font and palette. @default true
 * @returns The HTML fragment, the same SVG unwrapped, the data files the spec read, and any Vega warnings.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Vega-Lite spec as a parsed object or a JSON string. */
    spec: Record<string, unknown> | string;
    /** Overrides the spec's width, in pixels. @minimum 50 @maximum 4000 */
    width?: number;
    /** Overrides the spec's height, in pixels. @minimum 50 @maximum 4000 */
    height?: number;
    /** Apply the host UI font and palette. @default true */
    theme?: boolean;
}): Promise<{ html: string; svg: string; sources: { url: string; rows: number; bytes: number; remote: boolean }[]; warnings: string[] }> {
    let parsed: Record<string, unknown>;
    if (typeof opts.spec === "string") {
        try { parsed = JSON.parse(opts.spec); }
        catch (error: any) { throw new Error(`vegalite: spec is not valid JSON: ${error?.message ?? error}`); }
    } else {
        parsed = opts.spec;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("vegalite: spec must be a JSON object");

    const { spec: withData, sources } = await ctx.fns.vegalite.inlineData({ spec: parsed });
    const sized: Record<string, unknown> = { ...withData };
    // Only a single-view spec has a top-level width/height; setting it on a
    // layered or faceted spec is an error in Vega-Lite, so leave those alone.
    const composed = ["layer", "hconcat", "vconcat", "concat", "facet", "repeat"].some(key => key in sized);
    if (!composed) {
        if (typeof opts.width === "number") sized.width = opts.width;
        if (typeof opts.height === "number") sized.height = opts.height;
    }

    const config = opts.theme === false
        ? (sized.config as Record<string, unknown> | undefined)
        : { ...ctx.fns.vegalite.theme({}), ...(sized.config as Record<string, unknown> | undefined) };

    let compiled;
    try { compiled = compile({ ...sized, ...(config ? { config } : {}) } as any); }
    catch (error: any) { throw new Error(`vegalite: ${error?.message ?? error}`); }

    const warnings: string[] = [];
    const view = new vega.View(vega.parse(compiled.spec), {
        renderer: "none",
        loader: blockingLoader(),
        logger: vega.logger(vega.Warn, "error") as any,
    });
    (view as any).warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); return view; };

    let raw: string;
    try { raw = await view.toSVG(); }
    finally { view.finalize(); }

    // One SVG, not two: `svg` is exactly what the fragment contains, so saving
    // it to a file and embedding the html give the same picture.
    const svg = responsive(raw);
    // Layout lives in $style_vegalite.css, shipped with this plugin.
    return { html: `<div class="vegalite-chart">${svg}</div>`, svg, sources, warnings };
}
