/**
 * Strips active content from an exported SVG so it can be inlined in chat and pages.
 *
 * Removes script and foreignObject elements, on* event attributes and javascript: URLs,
 * keeping shapes, text, embedded fonts and images intact.
 * @param opts.svg SVG markup exported by the Excalidraw editor.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** SVG markup exported by the Excalidraw editor. */
    svg: string;
}): string {
    return String(opts.svg ?? "")
        .replace(/<\?xml[^>]*>/gi, "")
        .replace(/<!DOCTYPE[^>]*>/gi, "")
        .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<script[^>]*\/>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "")
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}
