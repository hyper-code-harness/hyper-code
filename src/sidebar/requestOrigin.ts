/**
 * Validate loopback transport and browser extension origin for sidebar requests.
 *
 * Accept the configured HTTPS listener or legacy loopback transport, then validate the caller Origin.
 * @param opts.req Incoming HTTP request to check.
 * @param opts.extension Require Chrome extension origin instead of exact Hyper origin.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming HTTP request to check. */
        req: Request;
        /** Require Chrome extension origin instead of exact Hyper origin. */
        extension: boolean;
    },
): Promise<string> {
    const u=new URL(opts.req.url);
    const peer=ctx.state.procs?.http?.server?.server?.requestIP(opts.req)?.address;
    const loopback=u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!['forwarded','x-forwarded-host','x-forwarded-for','x-forwarded-proto'].some(h=>opts.req.headers.has(h))&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer);
    const h2=(ctx.state as any).h2;const https=u.protocol==='https:'&&opts.req.headers.get('x-forwarded-proto')==='https'&&h2?.port===Number(u.port||443)&&(!h2.tsName||u.hostname===h2.tsName);
    if(!loopback&&!https)throw new Error('trusted_transport_required');
    const origin=opts.req.headers.get('origin')??'';
    if(opts.extension ? !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) : origin!==u.origin)throw new Error('origin_rejected');
    return origin;
}
