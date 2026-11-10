// A static browser asset (compiled stylesheet, bundled script) answered with a
// strong ETag so a repeat visit costs one 304 round trip and zero bytes. The
// hash is cached per (path, mtime, size) on ctx.state.procs.http.etags — a
// rebuilt file changes mtime and is hashed once more; an untouched one never is.
import { createHash } from "node:crypto";

/**
 * Serves a file from disk with a strong content ETag and conditional GET: when the request's `If-None-Match`
 * (list form and `W/` prefix included) names the current ETag, answers `304 Not Modified` with no body;
 * otherwise `200` with the body, `ETag` and `cache-control: public, max-age=0, must-revalidate` (overridable).
 * Use it from asset loaders ($style_, $script_) — not for SSE or dynamic pages.
 * @param opts.path Absolute path of the file to serve.
 * @param opts.contentType Value of the `content-type` header, e.g. `text/css; charset=utf-8`.
 * @param opts.req The incoming request; its `If-None-Match` header decides between 200 and 304. Omitted → always 200.
 * @param opts.cacheControl `cache-control` header value. @default "public, max-age=0, must-revalidate"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Absolute path of the file to serve. */
    path: string;
    /** Value of the `content-type` header, e.g. `text/css; charset=utf-8`. */
    contentType: string;
    /** The incoming request; its `If-None-Match` header decides between 200 and 304. Omitted → always 200. */
    req?: Request;
    /** `cache-control` header value. @default "public, max-age=0, must-revalidate" */
    cacheControl?: string;
}): Promise<Response> {
    const file = Bun.file(opts.path);
    const stat = await file.stat();
    const cache = ((ctx.state.procs.http as any).etags ??= {}) as Record<string, { mtime: number; size: number; etag: string }>;
    let hit = cache[opts.path];
    if (!hit || hit.mtime !== stat.mtimeMs || hit.size !== stat.size) {
        const etag = `"${createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex")}"`;
        hit = cache[opts.path] = { mtime: stat.mtimeMs, size: stat.size, etag };
    }
    const headers: Record<string, string> = {
        "etag": hit.etag,
        "cache-control": opts.cacheControl ?? "public, max-age=0, must-revalidate",
        "last-modified": new Date(stat.mtimeMs).toUTCString(),
    };
    if (matches(opts.req?.headers.get("if-none-match"), hit.etag)) return new Response(null, { status: 304, headers });
    return new Response(file, { headers: { ...headers, "content-type": opts.contentType } });
}

// RFC 9110 §13.1.2: `*`, or a comma-separated list of entity tags, each possibly weak (`W/"..."`).
// A weak comparison is enough for a GET answered from the same bytes.
function matches(header: string | null | undefined, etag: string): boolean {
    if (!header) return false;
    if (header.trim() === "*") return true;
    const bare = etag.replace(/^W\//, "");
    return header.split(",").some(tag => tag.trim().replace(/^W\//, "") === bare);
}
