/**
 * Matches an HTTP method and pathname against the live route table.
 * Exact routes win; parameterized segments are decoded and returned by name. Malformed percent encoding produces a 400 handler rather than throwing a server error.
 * @param opts.method HTTP method, such as `GET` or `POST`.
 * @param opts.pathname URL pathname beginning with `/`.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: { method: string; pathname: string },
): { handler: Function; params: Record<string, string>; path: string } | null {
    const { method, pathname } = opts;
    const routes = ctx.state.procs?.http.routes;
    const exact = routes[pathname];
    if (exact && exact[method]) return { handler: exact[method], params: {}, path: pathname };

    const urlSegs = pathname.split("/").filter(Boolean);
    for (const [pattern, methods] of Object.entries(routes)) {
        const h = methods[method];
        if (!h) continue;
        const patSegs = pattern.split("/").filter(Boolean);
        if (patSegs.length !== urlSegs.length) continue;
        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < patSegs.length; i++) {
            const p = patSegs[i]!;
            const u = urlSegs[i]!;
            if (p.startsWith(":")) {
                try { params[p.slice(1)] = decodeURIComponent(u); }
                catch { return {handler: () => new Response('Malformed path encoding', {status: 400}), params: {}, path: pattern}; }
            } else if (p !== u) {
                ok = false;
                break;
            }
        }
        // The PATTERN, not the url: `/chart/:id` is what a log line or a metric
        // should group by, `/chart/42` is one of its instances.
        if (ok) return { handler: h, params, path: pattern };
    }
    return null;
}
