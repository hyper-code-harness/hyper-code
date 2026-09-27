import { stat } from "node:fs/promises";

// Path-based Files URLs make the filesystem hierarchy visible to the browser:
// /files/absolute/Users/me/project/docs/readme.md. A request for an existing
// file renders the Files page; a relative asset request under that URL streams
// the file itself, so Markdown images and HTML/CSS resources work naturally.
/**
 * Serves path-based Files UI pages and relative assets under `/files/absolute`.
 * Use the canonical URL produced by `files.browserUrl`; this middleware handles
 * any number of path segments because ordinary runtime routes match fixed arity.
 * @param opts.req Incoming GET or HEAD request below `/files/absolute`.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    if (opts.req.method !== "GET" && opts.req.method !== "HEAD") return;
    const url = new URL(opts.req.url);
    const prefix = "/files/absolute";
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) return;

    let decoded: string;
    try {
        decoded = decodeURIComponent(url.pathname.slice(prefix.length));
    } catch {
        return new Response("bad path", { status: 400 });
    }
    const absolute = decoded.startsWith("/") ? decoded : "/" + decoded;
    const info = await stat(absolute).catch(() => null);
    if (!info) return new Response("not found", { status: 404 });

    if (info.isDirectory() || url.searchParams.has("tab") || ctx.fns.files.isPageRequest({ req: opts.req, path: absolute })) {
        const target = new URL("/files", url.origin);
        target.searchParams.set("path", absolute);
        const tab = url.searchParams.get("tab");
        if (tab) target.searchParams.set("tab", tab);
        if (url.searchParams.get("embed") === "1") target.searchParams.set("embed", "1");
        if (url.searchParams.get("wide") === "1") target.searchParams.set("wide", "1");
        const headers: Record<string, string> = {};
        // Internal dispatch re-enters global auth middleware; preserve the
        // browser session and forwarded origin/host, not only render headers.
        for (const name of ["accept", "hx-request", "x-hyper-fragment", "cookie", "host", "origin", "x-forwarded-host", "x-forwarded-proto"]) {
            const value = opts.req.headers.get(name);
            if (value) headers[name] = value;
        }
        return ctx.fns.procs.http.dispatch({ url: target.pathname + target.search, method: opts.req.method, headers });
    }

    return ctx.fns.files.rawResponse({ path: absolute, method: opts.req.method });
}
