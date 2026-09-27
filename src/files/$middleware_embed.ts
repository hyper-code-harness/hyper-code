import { stat } from "node:fs/promises";

// /files/embed/<absolute path> is the stable iframe namespace. Relative links
// stay below /files/embed automatically, so embed mode cannot fall off during
// Markdown, breadcrumb, directory, or tab navigation.
/**
 * Serves embedded Files UI pages and their relative assets under `/files/embed`.
 * @param opts.req Incoming GET or HEAD request below `/files/embed`.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    if (opts.req.method !== "GET" && opts.req.method !== "HEAD") return;
    const url = new URL(opts.req.url);
    const prefix = "/files/embed";
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
        target.searchParams.set("embed", "1");
        const tab = url.searchParams.get("tab");
        if (tab) target.searchParams.set("tab", tab);
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
