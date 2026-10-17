// GET /rpc/<fn>?<json> — a page made by a `@view` function, by address. The query is the call's params as JSON
// (rpc.url builds the canonical form); `?a=1&b=2` is accepted for hand-typed links, values as strings.
// Only functions tagged `@view` answer: GET carries no CSRF token, so it must not change anything.

const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);

/** Serves the page of a `@view` function at its address. */
export default async function (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const name = String(opts.params.fn ?? "").trim();
    const page = (o: { value?: unknown; error?: string; status?: number }) => ctx.fns.rpc.page({ title: name || "rpc", ...o });
    // The global middleware put the signed-in person on the session; a direct call asks here.
    let user = (session as any)?.user ?? null;
    let setCookie: string | null = null;
    if (!user) {
        const who = await ctx.fns.auth.currentUser({ req: opts.req });
        user = who.user; setCookie = who.setCookie ?? null;
        if (who.required && !who.user && !who.legacy) return page({ error: "sign in to open this page", status: 401 });
    }
    // An open instance (no sign-in configured) is its owner's: the page reads as the owner.
    if (!user) user = ((await ctx.fns.procs.db.select({ sql: "SELECT id, email, name, role FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1", params: [] })) as any[])[0] ?? null;
    const done = (res: Response) => { if (setCookie) res.headers.append("set-cookie", setCookie); return res; };

    const parts = name.split(".");
    if (parts.length < 2 || parts.some(p => !p || BLOCKED.has(p) || !/^[A-Za-z_$][\w$]*$/.test(p))) return done(page({ error: `not a function name: ${name}`, status: 400 }));
    let meta: Record<string, any>;
    try { meta = ctx.fns.runtime.docs.get({ name }); }
    catch { return done(page({ error: `no such function: ${name}`, status: 404 })); }
    if (!meta.view) return done(page({ error: `${name} is not a view: only functions tagged @view open by address`, status: 405 }));
    const access = await ctx.fns.project.canCall({ name, userId: user?.id ?? undefined });
    if (!access.allowed) return done(page({ error: `forbidden: ${access.reason}`, status: 403 }));

    let params: Record<string, unknown> = {};
    const raw = new URL(opts.req.url).search.slice(1);
    if (raw) {
        // Not percent-encoded (a hand-typed link): read the query as it is.
        const text = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
        if (text.trimStart().startsWith("{")) {
            try { params = JSON.parse(text); }
            catch { return done(page({ error: "the query is not valid JSON", status: 400 })); }
        } else params = Object.fromEntries(new URLSearchParams(raw));
        if (!params || typeof params !== "object" || Array.isArray(params)) return done(page({ error: "params must be a JSON object", status: 400 }));
    }

    // The view reads as the person: its ctx carries them on the session (memory.visible and friends use it).
    const as: any = Object.create(ctx);
    as.session = { ...((session as any) ?? { kind: "http" }), user };
    let fn: any = as.fns;
    for (const p of parts) fn = fn?.[p];
    if (typeof fn !== "function") return done(page({ error: `no such function: ${name}`, status: 404 }));
    const started = performance.now();
    try {
        const value = await Promise.race([fn(params), new Promise((_, reject) => setTimeout(() => reject(new Error("view timeout")), 30_000))]);
        ctx.fns.procs.log.info({ event: "rpc.view", method: name, durationMs: Math.round(performance.now() - started), ok: true });
        return done(page({ value }));
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "rpc.view", method: name, durationMs: Math.round(performance.now() - started), ok: false, error: String(error?.message ?? error) });
        return done(page({ error: String(error?.message ?? error), status: 400 }));
    }
}
