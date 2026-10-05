/**
 * Resolves the browser-visible request origin behind a trusted local reverse proxy
 *
 * Returns req.url origin normally, or X-Forwarded-Proto plus X-Forwarded-Host only when the immediate TCP peer is loopback. Use for same-origin CSRF checks on browser POST routes served through Hyperlet or Traefik.
 * @param opts.req Incoming browser request whose public origin is needed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming browser request whose public origin is needed. */
        req: Request;
    },
): Promise<string> {
    const req = opts.req;
    const target = new URL(req.url);
    let peer: string | undefined;
    try { peer = (ctx.state as any)?.procs?.http?.server?.server?.requestIP?.(req)?.address; } catch {}
    if (!peer || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) return target.origin;
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    if ((proto !== "https" && proto !== "http") || !host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return target.origin;
    return `${proto}://${host}`;
}
