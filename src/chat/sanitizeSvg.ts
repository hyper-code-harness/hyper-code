import { parseFragment, serialize } from "parse5";

// Elements an icon may use: shapes, text, gradients, clipping and filters. Everything else (script,
// foreignObject, image, animation, iframe, style…) is dropped together with its children.
const TAGS = new Set([
    "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "textpath",
    "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "symbol", "use", "title", "desc",
    "filter", "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "fecomposite", "feflood", "femerge", "femergenode", "fedropshadow",
]);
const LOCAL_REF = /^#[\w:.-]+$/;

/**
 * Cleans untrusted SVG markup into a small self-contained icon image.
 *
 * Keeps only drawing elements (shapes, text, gradients, masks, filters) and drops scripts, event handlers,
 * foreignObject, embedded images, animation, external links and url() references that leave the document,
 * so the result is safe to store and show anywhere. The root must be one <svg>; xmlns is added and a viewBox
 * is derived from width/height when missing. Use before saving a chat icon (chat.setIcon does it).
 * Throws when the input is not SVG, has no size, or is larger than maxBytes after cleaning.
 * @param opts.svg Raw SVG markup.
 * @param opts.maxBytes Largest allowed result in bytes. @default 8192 @minimum 256 @maximum 65536
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Raw SVG markup. */
        svg: string;
        /** Largest allowed result in bytes. @default 8192 @minimum 256 @maximum 65536 */
        maxBytes?: number;
    },
): string {
    const max = Math.max(256, Math.min(65536, Number(opts.maxBytes ?? 8192) || 8192));
    const raw = String(opts.svg ?? "").replace(/<\?xml[^>]*>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
    if (raw.length > max * 8) throw new Error(`SVG is too large (${raw.length} chars)`);
    const frag: any = parseFragment(raw);
    const roots = (frag.childNodes ?? []).filter((n: any) => n.nodeName !== "#text" || String(n.value).trim());
    const root = roots[0];
    if (roots.length !== 1 || root?.nodeName !== "svg") throw new Error("expected exactly one <svg> element");
    const clean = (node: any) => {
        node.childNodes = (node.childNodes ?? []).filter((child: any) => {
            if (child.nodeName === "#text") return true;
            if (child.nodeName === "#comment" || !TAGS.has(String(child.nodeName).toLowerCase())) return false;
            clean(child);
            return true;
        });
        if (!node.attrs) return;
        node.attrs = node.attrs.filter((a: any) => {
            const name = String(a.prefix ? `${a.prefix}:${a.name}` : a.name).toLowerCase();
            const value = String(a.value ?? "");
            if (name.startsWith("on") || name === "style" && /url\(\s*['"]?(?!#)/i.test(value)) return false;
            if (name === "href" || name === "xlink:href") return LOCAL_REF.test(value.trim());
            if (/url\(\s*['"]?(?!#)/i.test(value) || /javascript:/i.test(value)) return false;
            if (name.startsWith("xmlns")) return false;
            return true;
        });
    };
    clean(root);
    const attr = (n: string) => root.attrs.find((a: any) => a.name === n)?.value;
    if (!attr("viewBox")) {
        const w = parseFloat(attr("width") ?? ""), h = parseFloat(attr("height") ?? "");
        if (!(w > 0 && h > 0)) throw new Error("SVG needs a viewBox (or width and height)");
        root.attrs.push({ name: "viewBox", value: `0 0 ${w} ${h}` });
    }
    root.attrs.unshift({ name: "xmlns", value: "http://www.w3.org/2000/svg" });
    if (root.attrs.some((a: any) => a.prefix === "xlink") || /xlink:href/.test(serialize(root))) root.attrs.push({ name: "xmlns:xlink", value: "http://www.w3.org/1999/xlink" });
    const out = serialize({ nodeName: "#document-fragment", childNodes: [root] } as any)
        .replace(/&nbsp;/g, "&#160;")
        .replace(/>\s+</g, "><")
        .trim();
    if (new TextEncoder().encode(out).length > max) throw new Error(`SVG is larger than ${max} bytes after cleaning`);
    return out;
}
