// One call of a `@view` function by address, shared by GET /rpc/<fn> and the canvas view tab (which draws the
// fragment into the panel on the server, so opening a tab is one request, not a panel and then a fetch).

const BLOCKED = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Calls a `@view` function from its address and returns its html fragment (rpc.page) with an HTTP status.
 *
 * Use wherever a view is shown: GET /rpc/<fn>?<json> and the canvas view tab. Accepts `url` (`/rpc/<fn>?<json>`,
 * or `?a=1&b=2` for hand-typed links) or `fn` + `params`. Refuses functions without `@view` (405) and those the
 * person may not call (project.canCall, 403). The view reads as the signed-in person (`user`, or the session's),
 * else as the calling agent, else as the instance owner (an open instance). A view tagged `@live <topic>` comes
 * back as a live region that re-fetches its address when the server refreshes that topic. Errors never throw: they come back as an error fragment and a status.
 * @param opts.url Address `/rpc/<fn>?<json>`.
 * @param opts.fn Function name instead of url.
 * @param opts.params Arguments with fn.
 * @param opts.user The person the view reads as; defaults to the session's.
 * @param opts.agentId The agent the view reads as when the session has neither a person nor an agent — a canvas tab
 * passes its own agent, because the panel request that draws it carries none.
 * @param opts.timeoutMs Give up after this long. @default 30000
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Address `/rpc/<fn>?<json>`. */
    url?: string;
    /** Function name instead of url. */
    fn?: string;
    /** Arguments with fn. */
    params?: Record<string, unknown>;
    /** The person the view reads as; defaults to the session's. */
    user?: { id: string; role?: string; [key: string]: unknown } | null;
    /** The agent the view reads as when the session has neither a person nor an agent; the session's wins. */
    agentId?: string;
    /** Give up after this long. @default 30000 */
    timeoutMs?: number;
}): Promise<{ html: string; status: number; fn: string }> {
    let name = String(opts.fn ?? "").trim();
    let params: Record<string, unknown> = opts.params ?? {};
    const out = (status: number, o: { value?: unknown; error?: string }) => ({ html: ctx.fns.rpc.page({ title: name || "rpc", ...o }), status, fn: name });
    if (!name && opts.url) {
        let u: URL;
        try { u = new URL(String(opts.url), "http://hyper.local"); } catch { return out(400, { error: `not an address: ${opts.url}` }); }
        const m = /^\/rpc\/([^/]+)$/.exec(u.pathname);
        if (!m) return out(400, { error: `the address must be /rpc/<fn>?<json>, got ${u.pathname}` });
        try { name = decodeURIComponent(m[1]!); } catch { return out(400, { error: "bad function name" }); }
        const raw = u.search.slice(1);
        if (raw) {
            // Not percent-encoded (a hand-typed link): read the query as it is.
            const text = (() => { try { return decodeURIComponent(raw); } catch { return raw; } })();
            if (text.trimStart().startsWith("{")) {
                try { params = JSON.parse(text); } catch { return out(400, { error: "the query is not valid JSON" }); }
            } else params = Object.fromEntries(new URLSearchParams(raw));
        }
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) return out(400, { error: "params must be a JSON object" });
    const parts = name.split(".");
    if (parts.length < 2 || parts.some(p => !p || BLOCKED.has(p) || !/^[A-Za-z_$][\w$]*$/.test(p))) return out(400, { error: `not a function name: ${name}` });
    let meta: Record<string, any>;
    try { meta = ctx.fns.runtime.docs.get({ name }); } catch { return out(404, { error: `no such function: ${name}` }); }
    if (!meta.view) return out(405, { error: `${name} is not a view: only functions tagged @view open by address` });
    let user = opts.user !== undefined ? opts.user : ((session as any)?.user ?? null);
    const agentId = (session as any)?.agentId ?? (opts.agentId || undefined);
    // Neither a person nor an agent (an open instance without sign-in, a panel drawn outside a request): the
    // instance is its owner's, so the view reads as the owner — the same rule as GET /rpc.
    if (!user && !agentId) user = ((await ctx.fns.procs.db.select({ sql: "SELECT id, email, name, role FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1", params: [] })) as any[])[0] ?? null;
    if (user || !agentId) {
        const access = await ctx.fns.project.canCall({ name, userId: user?.id ?? undefined });
        if (!access.allowed) return out(403, { error: `forbidden: ${access.reason}` });
    }

    // The view reads as the person when there is one (memory.visible and friends use session.user).
    const as: any = Object.create(ctx);
    as.session = user ? { ...((session as any) ?? { kind: "http" }), user, agentId: undefined }
        : agentId && (session as any)?.agentId !== agentId ? { ...((session as any) ?? { kind: "http" }), agentId } : session;
    let fn: any = as.fns;
    for (const p of parts) fn = fn?.[p];
    if (typeof fn !== "function") return out(404, { error: `no such function: ${name}` });
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const value = await Promise.race([fn(params), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("view timeout")), opts.timeoutMs ?? 30_000); })]);
        ctx.fns.procs.log.info({ event: "rpc.view", method: name, durationMs: Math.round(performance.now() - started), ok: true });
        const page = out(200, { value });
        // A `@live <topic>` view re-fetches itself (its own address, as htmx) when the server refreshes the topic:
        // client.js dispatches `hyper-live` to regions of that topic; the answer (this same wrapper) replaces it.
        if (typeof meta.live === "string" && meta.live) {
            const esc = (text: string) => ctx.fns.w.escape({ text });
            page.html = `<div class="rpc-live" hx-get="${esc(ctx.fns.rpc.url({ fn: name, params }))}" hx-trigger="hyper-live" hx-swap="outerHTML" hx-target="this" data-live-topic="${esc(meta.live)}">${page.html}</div>`;
        }
        return page;
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: "rpc.view", method: name, durationMs: Math.round(performance.now() - started), ok: false, error: String(error?.message ?? error) });
        return out(400, { error: String(error?.message ?? error) });
    } finally {
        clearTimeout(timer);
    }
}
