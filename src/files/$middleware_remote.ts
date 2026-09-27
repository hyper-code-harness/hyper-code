// /files/remote/<host>/<absolute path> — the Files UI for a directory on an SSH
// host (a remote agent workspace). Same shape as /files/absolute and
// /files/embed: pages dispatch to GET /files?host=…&path=…, relative asset
// requests (Markdown images, HTML/CSS) stream the remote file itself.
/**
 * Serves path-based Files UI pages and relative assets for files on an SSH host under `/files/remote/<host>`.
 * The host must be an alias from the ssh config (remote.servers); anything else is refused.
 * `/files/remote/embed/<host>/…` serves the same pages in the embedded (popup) layout.
 * @param opts.req Incoming GET or HEAD request below `/files/remote` (including `/files/remote/embed`).
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    if (opts.req.method !== "GET" && opts.req.method !== "HEAD") return;
    const url = new URL(opts.req.url);
    // /files/remote/embed/<host>/… is the same view in the embedded (popup)
    // layout; the middleware prefix is /files/remote, so embed nests below it.
    // (An ssh alias named "embed" is reachable through the embed form only.)
    const embed = url.pathname.startsWith("/files/remote/embed/");
    const prefix = embed ? "/files/remote/embed/" : "/files/remote/";
    if (!url.pathname.startsWith(prefix)) return;

    const rest = url.pathname.slice(prefix.length);
    const slash = rest.indexOf("/");
    let host: string, absolute: string;
    try {
        host = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
        absolute = "/" + decodeURIComponent(slash < 0 ? "" : rest.slice(slash + 1));
    } catch {
        return new Response("bad path", { status: 400 });
    }
    if (!(await ctx.fns.remote.servers({})).some(s => s.name === host)) return new Response("unknown host", { status: 404 });
    const info = await ctx.fns.files.stat({ path: absolute, host }).catch(() => null);
    if (!info) return new Response("not found", { status: 404 });

    if (info.isDir || url.searchParams.has("tab") || isPageRequest(opts.req, absolute)) {
        const target = new URL("/files", url.origin);
        target.searchParams.set("path", absolute);
        target.searchParams.set("host", host);
        if (embed) target.searchParams.set("embed", "1");
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

    return ctx.fns.files.rawResponse({ path: absolute, host, method: opts.req.method });
}

function isPageRequest(req: Request, path: string): boolean {
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("text/html") || accept === "" || accept === "*/*") return true;
    return /\.(?:md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|css|html?|xml|sql|py|rs|go|java|sh|bash|zsh|diff)$/i.test(path)
        && !accept.startsWith("image/") && !accept.startsWith("audio/") && !accept.startsWith("video/");
}
