import { makeRequestCtx } from "../boot/requestCtx";

/**
 * Start the http subsystem.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const { port, host } = ctx.fns.procs.config.resolve({ module: "procs/http" }) as ConfigOf<typeof import("./$config").default>;
    const runtimeDir = ctx.fns.procs.project.runtimeDir({});
    await Bun.write(`${runtimeDir}/.keep`, "");
    const logFile = Bun.file(`${runtimeDir}/http.log`).writer();
    ctx.state.procs.http.logFile = logFile;

    const server = Bun.serve({
        // Bun drops a request after 10s by default. The first request that needs
        // a service the supervisor is still bringing up legitimately waits for
        // it, and dying at ten seconds looks like a hang with no line in the log.
        idleTimeout: 120,
        port,
        hostname: host || "0.0.0.0",
        async fetch(req) {
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
            const m = ctx.fns.procs.http.match({ method: req.method, pathname: url.pathname });
            // Request ctx: inherits root ctx, carries the session. Everything
            // the handler calls via rctx.fns.* gets this session implicitly. It
            // is built even with no route, because middleware runs either way.
            const rctx = makeRequestCtx(ctx, { kind: 'http', req, params: m?.params ?? {}, url, route: m?.path });
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
                const raw = await m.handler(rctx, rctx.session, { req, params: m.params });
                const res = await rctx.fns.procs.http.toResponse({ value: raw });
                log(rctx, logFile, req.method, url.pathname + url.search, res.status, performance.now() - t0);
                return stamp(res);
            } catch (e: any) {
                log(rctx, logFile, req.method, url.pathname + url.search, 500, performance.now() - t0, e?.message);
                const dev = ctx.env.NODE_ENV !== 'production';
                const body = dev ? `${e?.message}\n\n${e?.stack ?? ''}` : 'Internal Server Error';
                return stamp(new Response(body, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
            }
        },
    });
    // The port the server actually got, not the one that was asked for: `port: 0`
    // means "any free one", and a client reading .runtime/port has no other way
    // to find the process.
    const bound = server.port ?? port;
    ctx.state.procs.http.server = { server, port: bound };
    await Bun.write(`${runtimeDir}/port`, String(bound));
    ctx.fns.procs.log.info({ event: "http.listening", msg: `http://${host && host !== "0.0.0.0" ? host : "localhost"}:${bound}`, port: bound, host, portFile: `${runtimeDir}/port` });
}

// Response wrapping lives in http/toResponse.ts (shared with http.dispatch).

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
    try {
        sink.write(`${ts} ${method.padEnd(6)} ${String(status).padEnd(3)} ${dur.padStart(7)}  ${path}${err ? `  ${err}` : ""}\n`);
        sink.flush();
    } catch { /* writer closed */ }
}
