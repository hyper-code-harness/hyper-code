import { resolve } from "node:path";

// Turn a local image into the provider-neutral content shape used by pi-mono:
// base64 bytes plus a real MIME type. Paths are resolved in the agent workspace.
/** Image content for the runtime.  * @param opts.path File path to read or render.
*/
export default async function (
    _ctx: Context,
    session: Session | null,
    opts: {
        /** Path to the target resource. */
    path: string },
): Promise<types.tools.Content> {
    const base = session?.agent?.workspaceHost ? process.cwd() : (session?.agent?.workspaceDir || process.cwd());
    const path = resolve(base, opts.path);
    const file = Bun.file(path);
    if (!await file.exists()) throw new Error(`image not found: ${path}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = sniff(bytes);
    if (!mimeType) throw new Error("unsupported image (expected PNG, JPEG, GIF, or WebP)");
    // Keep below Anthropic's 5 MB base64 limit. Resizing can be added later;
    // screenshots at normal browser dimensions are generally well below this.
    const data = Buffer.from(bytes).toString("base64");
    if (Buffer.byteLength(data) > 4.5 * 1024 * 1024) throw new Error("image exceeds the 4.5 MB inline limit");
    return { type: "image", data, mimeType };
}

function sniff(b: Uint8Array): string | null {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b.length >= 6 && String.fromCharCode(...b.slice(0, 6)) .startsWith("GIF8")) return "image/gif";
    if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
    return null;
}
