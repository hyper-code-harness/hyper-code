// Global application middleware: user sign-in gate plus current-screen tracking.
// Sign-in is required once a user has a password (DESIGN §34). A lone user without one keeps
// today's open local behavior but is still attached to the session, so authorship is recorded.
export default async function (ctx: Context, session: Session | null, opts: { req: Request }): Promise<Response | void> {
    const url = new URL(opts.req.url);
    // Browsers opening a page over plain HTTP go to the HTTPS/HTTP2 address.
    const toHttps = ctx.fns.h2.redirect({ req: opts.req });
    if (toHttps) return toHttps;
    // Dedicated bridge owns its narrow authentication. Its bearer is never a UI/REPL credential.
    if (url.pathname.startsWith('/sidebar/api/')) return ctx.fns.sidebar.bridge({ req: opts.req });
    if (url.pathname.startsWith('/sidebar/approve/')) return ctx.fns.sidebar.approval({ req: opts.req });
    const publicPath = url.pathname === "/auth/login" || url.pathname === "/auth/logout" || url.pathname === "/auth/setup" || url.pathname === "/favicon.ico";
    // /procs/repl, /external/* and /node/v1/* check loopback + their own scoped tokens.
    const infrastructurePath = url.pathname === "/procs/repl" || url.pathname.startsWith("/external/") || url.pathname.startsWith("/node/v1/");
    const who = publicPath || infrastructurePath ? null : await ctx.fns.auth.currentUser({ req: opts.req });
    if (session && who?.user) (session as any).user = who.user;
    if (who?.required) {
    if (url.pathname.startsWith('/sidebar/draft/')) return ctx.fns.sidebar.draft({ req: opts.req });
        {
            const user = who.user;
            if (!user && !who.legacy) {
                const wantsHTML = (opts.req.headers.get("accept") ?? "").includes("text/html") && opts.req.method === "GET";
                if (wantsHTML) return new Response(null, { status: 303, headers: { location: `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" } });
                return Response.json({ error: "unauthorized", message: "Authentication required" }, { status: 401, headers: { "cache-control": "no-store" } });
            }
            if (!["GET", "HEAD", "OPTIONS"].includes(opts.req.method.toUpperCase())) {
                const origin = opts.req.headers.get("origin");
                const forwardedHost = opts.req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
                const expectedHost = forwardedHost || opts.req.headers.get("host") || url.host;
                if (origin && new URL(origin).host !== expectedHost) return Response.json({ error: "cross_origin", message: "Cross-origin write rejected" }, { status: 403 });
            }
        }
    }

    if (opts.req.method !== "GET") return;
    const agent = /^\/(?:a|agent)\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1];
    if (!agent || agent === "new") return;
    const state = ((ctx.state as any).screen ??= { nextId: 1, pending: new Map() });
    state.here = { url: url.pathname + url.search, agentId: agent, at: new Date().toISOString() };
}
