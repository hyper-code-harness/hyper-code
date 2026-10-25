/**
 * Checks a URL a widget is about to put in href or src: a local path ("/x", not "//host"), an in-page "#anchor",
 * or http(s); with image true also data:image. Anything else (javascript:, protocol-relative, data:text…) gives
 * null, so the widget renders no link at all.
 * @param opts.url The URL to check.
 * @param opts.image Allow data:image/… (for img src). @default false
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The URL to check. */
    url: string;
    /** Allow data:image/… (for img src). @default false */
    image?: boolean;
}): string | null {
    const u = String(opts.url ?? "").trim();
    if (!u) return null;
    if (u.startsWith("#")) return u;
    if (u.startsWith("/") && !u.startsWith("//") && !u.startsWith("/\\")) return u;
    if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
    if (opts.image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u;
    return null;
}
