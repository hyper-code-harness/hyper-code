const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Validates and dispatches an HTTP RPC request to a runtime function.
 * @param opts.req Incoming RPC request.
 */

export default async function (ctx: Context, session: Session | null, opts: { req: Request }) {
    const req = opts.req;
    // Same gate as every page: the global middleware already ran auth.currentUser (password and Google
    // cookies, server-side OIDC sessions with silent renewal, portal trust, the open instance) and put the
    // user and any renewed cookie on the session. Without it (a direct call) ask currentUser here.
    if ((session as any)?.user) return dispatch(ctx, req);
    const who = await ctx.fns.auth.currentUser({ req });
    const withCookie = (res: Response) => { if (who.setCookie) res.headers.append('set-cookie', who.setCookie); return res; };
    if (who.required && !who.user && !who.legacy) return withCookie(Response.json({ error: 'authentication required' }, { status: 401 }));
    return withCookie(await dispatch(ctx, req));
}

async function dispatch(ctx: Context, req: Request): Promise<Response> {
    const length = Number(req.headers.get('content-length') ?? 0);
    if (length > 256_000) return Response.json({ error: 'rpc body too large' }, { status: 413 });
    const csrf = req.headers.get('x-csrf-token') ?? '';
    if (!await ctx.fns.auth.verifyCsrf({ req, token: csrf })) return Response.json({ error: 'invalid csrf token' }, { status: 403 });
    let body: any;
    try {
        if ((req.headers.get('content-type') ?? '').includes('application/json')) body = await req.json();
        else {
            const form = await req.formData();
            const raw = String(form.get('params') ?? '{}');
            body = { method: form.get('method'), params: JSON.parse(raw) };
        }
    }
    catch { return Response.json({ error: 'invalid rpc payload' }, { status: 400 }); }
    const method = String(body?.method ?? '').trim();
    const params = body?.params ?? {};
    const parts = method.split('.').filter(Boolean);
    if (!parts.length || parts.some(part => BLOCKED.has(part) || !/^[A-Za-z_$][\w$-]*$/.test(part))) return Response.json({ error: 'invalid rpc method' }, { status: 400 });
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Response.json({ error: 'rpc params must be an object' }, { status: 400 });

    let fn: any = ctx.fns;
    try { for (const part of parts) fn = fn[part]; }
    catch { fn = null; }
    if (typeof fn !== 'function') return Response.json({ error: `rpc method not found: ${method}` }, { status: 404 });

    const started = performance.now();
    try {
        const value = await Promise.race([
            fn(params),
            new Promise((_, reject) => setTimeout(() => reject(new Error('rpc timeout')), 30_000)),
        ]);
        ctx.fns.procs.log.info({ event: 'rpc.call', method, durationMs: Math.round(performance.now() - started), ok: true });
        return ctx.fns.procs.http.toResponse({ value });
    } catch (error: any) {
        ctx.fns.procs.log.warn({ event: 'rpc.call', method, durationMs: Math.round(performance.now() - started), ok: false, error: String(error?.message ?? error) });
        return Response.json({ error: String(error?.message ?? error) }, { status: error?.message === 'rpc timeout' ? 504 : 400 });
    }
}
