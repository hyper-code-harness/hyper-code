const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Validates and dispatches an HTTP RPC request to a runtime function.
 * @param opts.req Incoming RPC request.
 */

export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const req = opts.req;
    const origin = req.headers.get('origin');
    const target = new URL(req.url);
    // Behind a reverse proxy (Traefik on the hub / hyperlet forward) the backend sees http://<host>/rpc while the browser's
    // Origin is the public https://<host>. The public origin comes from X-Forwarded-Proto/-Host, believed ONLY when the
    // immediate peer is loopback (the local hyperlet forward); any other peer is compared with req.url as before.
    const peer = (() => { try { return (ctx.state as any)?.procs?.http?.server?.server?.requestIP?.(req)?.address as string | undefined; } catch { return undefined; } })();
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const fhost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const trusted = !!peer && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
    const publicOrigin = trusted && (proto === 'https' || proto === 'http') && fhost && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(fhost) ? `${proto}://${fhost}` : null;
    const sameOrigin = (o: string | null) => !!o && (o === target.origin || o === publicOrigin);
    const fetchSite = req.headers.get('sec-fetch-site');
    if (origin && !sameOrigin(origin)) return Response.json({ error: 'cross-origin rpc refused' }, { status: 403 });
    if (fetchSite === 'cross-site') return Response.json({ error: 'cross-site rpc refused' }, { status: 403 });
    // The app itself can run without login. In that mode, permit only a real
    // same-origin browser request; scripts/curl on the LAN still need a signed
    // session because they do not carry the browser's Origin + Fetch Metadata.
    const user = await ctx.fns.procs.auth.authenticate({ req });
    const sameOriginBrowser = sameOrigin(origin) && fetchSite === 'same-origin';
    if (!user && !sameOriginBrowser) return Response.json({ error: 'authentication required' }, { status: 401 });
    const length = Number(req.headers.get('content-length') ?? 0);
    if (length > 256_000) return Response.json({ error: 'rpc body too large' }, { status: 413 });

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
