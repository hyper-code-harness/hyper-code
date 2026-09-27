/**
 * Decides whether a Files URL request wants the Files UI page or the raw file bytes.
 *
 * Browsers say what a request is for in Sec-Fetch-Dest: "document"/"iframe"
 * (navigation) gets the page; "script", "style", "image", "font", "video",
 * "audio", "empty" (fetch/XHR) and other subresources get the raw file, so an
 * HTML preview's own app.js or style.css is never answered with UI markup.
 * Without that header (curl, older clients) Accept decides: text/html → page,
 * image/audio/video → raw; a bare wildcard only counts as a page for document
 * types (Markdown, text, JSON…), never for CSS or JavaScript.
 * @param opts.req Incoming request.
 * @param opts.path Requested file path; its extension is the last hint.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request. */
        req: Request;
        /** Requested file path; its extension is the last hint. */
        path: string;
    },
): boolean {
    const dest = opts.req.headers.get("sec-fetch-dest");
    if (dest) return dest === "document" || dest === "iframe" || dest === "frame";
    const accept = opts.req.headers.get("accept") ?? "";
    if (accept.includes("text/html")) return true;
    if (/^(image|audio|video)\//.test(accept)) return false;
    if (accept && accept !== "*/*") return false;
    // No usable hint (address-bar style request): documents render, code assets stream.
    return /\.(?:md|markdown|txt|json|ya?ml|toml|xml|sql|py|rs|go|java|sh|bash|zsh|diff|ts|tsx|jsx)$/i.test(opts.path);
}
