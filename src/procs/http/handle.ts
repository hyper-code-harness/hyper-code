// One request through the whole HTTP pipeline: middleware by path prefix, then
// either a WebSocket upgrade (`$ws_<path>.ts`) or a route handler. The Bun
// server's `fetch` is only a call to this, so the pipeline hot-reloads like any
// function instead of being frozen in the closure `$start` created.
import { makeRequestCtx } from "../boot/requestCtx";

/**
 * Handles one incoming HTTP request for the running Hyper server: middleware, WebSocket upgrade or route, logging.
 *
 * Use as the Bun.serve fetch handler. A request carrying `Upgrade: websocket` whose path matches a
 * `$ws_<path>.ts` endpoint is upgraded only after every middleware for that path let it through, so
 * WebSockets share sign-in, cookies and forwarded-traffic rules with ordinary requests.
 * @param opts.req Incoming request.
 * @param opts.server Bun server that received it; required for WebSocket upgrades.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request. */
        req: Request;
        /** Bun server that received it; required for WebSocket upgrades. */
        server?: any;
    },
): Promise<Response | undefined> {
    const { req, server } = opts;
    const logFile = ctx.state.procs.http.logFile;
    const t0 = performance.now();
    const url = new URL(req.url);
    // Which process answered. A tab outlives the process it was rendered
    // by — a restart, a deploy — and then it holds javascript from one
    // version against markup from another: the fragment calls a function
    // its copy of the client does not have. The event stream carries the
    // same number, but a backgrounded tab's stream is the first thing to
    // die and the last to come back, while its htmx requests keep working
    // — which is exactly the tab that breaks. So every answer says who
    // gave it, and the page reloads itself when that changes.
    let rctxRef: any = null;
    const stamp = (res: Response) => {
        try { res.headers.set("x-procs-start", String((ctx.state as any).serverStart ?? 0)); } catch { /* immutable (a proxied response) */ }
        // Middleware may renew a session and leave the new cookie on the session; attach it to
        // whatever response the request ends with (page, fragment, API, redirect).
        const extra = rctxRef?.session?.setCookie;
        if (extra) { try { res.headers.append("set-cookie", String(extra)); } catch { /* immutable */ } }
        return res;
    };
    const wantsSocket = req.method === "GET" && (req.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
    const m = ctx.fns.procs.http.match({ method: wantsSocket ? "WS" : req.method, pathname: url.pathname });
    // Request ctx: inherits root ctx, carries the session. Everything
    // the handler calls via rctx.fns.* gets this session implicitly. It
    // is built even with no route, because middleware runs either way.
    const rctx = makeRequestCtx(ctx, { kind: wantsSocket ? 'ws' : 'http', req, params: m?.params ?? {}, url, route: m?.path });
    rctxRef = rctx;
    try {
        // Middleware (by path prefix) run BEFORE matching, and so also for
        // a path this app does not route: that is what lets one answer for
        // somebody else — the manager proxies `<workspace>.<domain>/git`
        // to a child it has no `/git` route of its own for. Matching first
        // turned every such deep link into a 404 the proxy never saw.
        for (const mw of ctx.fns.procs.http.middleware({ pathname: url.pathname })) {
            const short = await mw.handler(rctx, rctx.session, { req, params: m?.params ?? {} });
            if (short instanceof Response) {
                log(rctx, logFile, req.method, url.pathname + url.search, short.status, performance.now() - t0);
                return stamp(short);
            }
        }
        if (wantsSocket && m) {
            const endpoint = m.handler as unknown as types.procs.http.WsEndpoint;
            const res = await rctx.fns.procs.http.upgrade({ req, server, endpoint, params: m.params, path: m.path });
            log(rctx, logFile, "WS", url.pathname + url.search, res ? res.status : 101, performance.now() - t0);
            return res ? stamp(res) : undefined;
        }
        if (!m) {
            log(rctx, logFile, req.method, url.pathname + url.search, 404, performance.now() - t0);
            // A miss is a page too — the host's layout, the rail, a way
            // back — for anything that reads HTML. A fetch still gets
            // four bytes and the status.
            const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");
            return stamp(wantsHtml
                ? await rctx.fns.procs.http.toResponse({ value: rctx.fns.procs.ui.notFound({ url: url.pathname }) })
                : new Response("Not Found", { status: 404 }));
        }
        const raw = await (m.handler as Function)(rctx, rctx.session, { req, params: m.params });
        const res = await rctx.fns.procs.http.toResponse({ value: raw });
        log(rctx, logFile, req.method, url.pathname + url.search, res.status, performance.now() - t0);
        return stamp(res);
    } catch (e: any) {
        log(rctx, logFile, req.method, url.pathname + url.search, 500, performance.now() - t0, e?.message);
        const dev = ctx.env.NODE_ENV !== 'production';
        const body = dev ? `${e?.message}\n\n${e?.stack ?? ''}` : 'Internal Server Error';
        return stamp(new Response(body, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    }
}

// One request, one line — through the logger, so it is gated, formatted and
// traced like everything else. The session gives it method, url, route and user;
// only what the logger cannot know (status, duration) is passed.
// A beacon is not a request anybody wants to read. The open tab posts where it
// is (`/screen/here`) so nothing has to interrupt it to ask; at info level
// that is one line per navigation of noise between the lines somebody is
// actually reading. It goes to the file, where a trace belongs, and to the log
// only at debug — unless it failed, which is news.
const QUIET = new Set(["/screen/here", "/screen/result"]);

function log(rctx: any, sink: any, method: string, path: string, status: number, ms: number, err?: string) {
    const dur = ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(0)}ms`;
    const ts = new Date().toISOString();
    const level = status >= 500 ? "error" : QUIET.has(path) ? "debug" : "info";
    rctx.fns.procs.log[level]({
        event: "http.request", msg: `${method} ${status} ${dur} ${path}`,
        "http.status": status, "http.duration_ms": Math.round(ms * 100) / 100, ...(err ? { error: err } : {}),
    });
    if (!sink) return;
    try {
        sink.write(`${ts} ${method.padEnd(6)} ${String(status).padEnd(3)} ${dur.padStart(7)}  ${path}${err ? `  ${err}` : ""}\n`);
        sink.flush();
    } catch { /* writer closed */ }
}
