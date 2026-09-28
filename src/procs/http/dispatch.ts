// In-process HTTP call — no socket. Matches a route by convention, builds a
// request ctx + session, runs the handler, wraps the result. Use it to test
// REST without starting a server, or for internal sub-requests:
//   const res = await ctx.fns.procs.http.dispatch({ url: "/issues" });
//   expect(res.status).toBe(200); expect(await res.json()).toEqual([...]);
//   await ctx.fns.procs.http.dispatch({ method: "POST", url: "/issues/add", body: { title: "x" } });
// body: object → JSON; string / FormData / URLSearchParams → sent as-is.
import { makeRequestCtx } from "../boot/requestCtx";

/**
 * Perform dispatch for the http subsystem.
 * @param opts.method The HTTP method.
 * @param opts.url The target URL.
 * @param opts.body The HTTP body.
 * @param opts.headers The HTTP headers.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { method?: string; url: string; body?: any; headers?: Record<string, string> },
): Promise<Response> {
    const method = (opts.method ?? "GET").toUpperCase();
    const abs = opts.url.startsWith("http") ? opts.url : "http://localhost" + (opts.url.startsWith("/") ? "" : "/") + opts.url;
    const u = new URL(abs);

    const m = ctx.fns.procs.http.match({ method, pathname: u.pathname });

    const headers = new Headers(opts.headers ?? {});
    let body: any = opts.body;
    const plainObject = body && typeof body === "object"
        && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof ArrayBuffer);
    if (plainObject) {
        body = JSON.stringify(body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const req = new Request(abs, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body });

    // Request ctx: inherits this env-ctx (so dispatch on a forked test ctx runs
    // against the test env), carries the session through the call chain.
    const rctx = makeRequestCtx(ctx, { kind: "dispatch", req, params: m?.params ?? {}, url: u, route: m?.path });
    // Same as the server (http/$start.ts): a cookie renewed by middleware rides on the final response.
    const withSessionCookie = (res: Response) => {
        const extra = (rctx.session as any)?.setCookie;
        if (extra) { try { res.headers.append("set-cookie", String(extra)); } catch { /* immutable */ } }
        return res;
    };
    try {
        // Middleware first, matched route or not — see http/$start.ts.
        for (const mw of ctx.fns.procs.http.middleware({ pathname: u.pathname })) {
            const short = await mw.handler(rctx, rctx.session, { req, params: m?.params ?? {} });
            if (short instanceof Response) return withSessionCookie(short);
        }
        // A miss is a page for anything that reads HTML — same contract as the
        // server (http/$start.ts), so a test sees what a browser sees.
        if (!m) {
            return headers.get("accept")?.includes("text/html")
                ? rctx.fns.procs.http.toResponse({ value: rctx.fns.procs.ui.notFound({ url: u.pathname }) })
                : new Response("Not Found", { status: 404 });
        }
        const raw = await m.handler(rctx, rctx.session, { req, params: m.params });
        // On the REQUEST ctx, exactly as the server does it: toResponse reads the
        // session to decide between a document and a fragment, and the base ctx has
        // none — so wrapping there quietly returned the whole page to every htmx
        // caller, and no test could see the difference.
        return withSessionCookie(await rctx.fns.procs.http.toResponse({ value: raw }));
    } catch (e: any) {
        // Same 500 contract as the real server (http/$start.ts) — dispatch is
        // "the same path minus the socket", so a throwing handler is a Response.
        const dev = ctx.env.NODE_ENV !== "production";
        const body = dev ? `${e?.message}\n\n${e?.stack ?? ""}` : "Internal Server Error";
        return new Response(body, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
}
