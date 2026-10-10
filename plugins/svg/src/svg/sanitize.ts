// An SVG goes straight into the chat DOM, so it is markup with the same reach
// as the page around it. Everything removed here is a way for a drawing to stop
// being a drawing: script, event handlers, a request to another server, a
// stylesheet that leaks out of the figure.
//
// Deliberately a denylist over the source text rather than a parser: it keeps
// the plugin dependency-free, and the dangerous constructs in SVG are a short,
// well-known list. It is a second line of defence anyway — the first is that
// `tsx` fences do not run at all unless someone turned them on.

const BLOCK_WITH_BODY = /<(script|foreignObject|style|animate|set|handler)\b[\s\S]*?<\/\1\s*>/gi;
const SELF_CLOSING = /<(script|foreignObject|style|animate|animateTransform|animateMotion|set|handler)\b[^>]*\/?>/gi;
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const HREF_ATTR = /\s(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const URL_FUNC = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

/** A reference a drawing may keep: inside itself, or an image it carries inline. */
function localRef(value: string): boolean {
    const v = value.trim();
    return v.startsWith("#") || /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(v);
}

/**
 * Strips scripting, animation and off-server references from an SVG fragment.
 *
 * Use before putting SVG that was not written by this server into a page: it
 * removes `<script>`, `<style>`, `<foreignObject>`, SMIL animation elements,
 * every `on*` handler, and any `href`/`url()` that points anywhere but inside
 * the drawing or an inline data: image. The geometry, text and styling of a
 * normal drawing pass through untouched. The root `<svg>` is given the SVG
 * namespace when it lacks one, without which browsers render nothing.
 * @param opts.svg The SVG markup to clean.
 * @returns The cleaned markup and the names of the constructs that were removed.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The SVG markup to clean. */
    svg: string;
}): { svg: string; removed: string[] } {
    const removed: string[] = [];
    const note = (what: string) => { if (!removed.includes(what)) removed.push(what); };

    let out = String(opts.svg ?? "");
    out = out.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
    out = out.replace(BLOCK_WITH_BODY, (_m, tag) => (note(String(tag).toLowerCase()), ""));
    out = out.replace(SELF_CLOSING, (_m, tag) => (note(String(tag).toLowerCase()), ""));
    out = out.replace(/<\/(?:script|foreignObject|style|animate|animateTransform|animateMotion|set|handler)\s*>/gi, "");
    out = out.replace(EVENT_ATTR, () => (note("event handler"), ""));
    out = out.replace(HREF_ATTR, (full, dq, sq, bare) => {
        const value = dq ?? sq ?? bare ?? "";
        return localRef(value) ? full : (note("external reference"), "");
    });
    out = out.replace(URL_FUNC, (full, value) => (localRef(String(value)) ? full : (note("external reference"), "none")));

    out = out.trim();
    // A fragment with no root <svg> is not a drawing; saying so beats returning
    // markup that will silently do nothing in the page.
    const root = /<svg\b/i.exec(out);
    if (!root) throw new Error("svg: no <svg> root element");
    out = out.slice(root.index);
    if (!/\bxmlns\s*=/i.test(out.slice(0, out.indexOf(">") + 1))) {
        out = out.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return { svg: out, removed };
}
