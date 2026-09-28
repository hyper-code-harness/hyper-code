/**
 * Returns this Hyper's OIDC redirect URI: <origin>/auth/oidc/callback.
 *
 * Honors X-Forwarded-Proto/-Host behind a proxy so it matches the URI registered in the control plane.
 * @param opts.req Incoming request whose origin is used.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request whose origin is used. */
        req: Request;
    },
): string {
    const url = new URL(opts.req.url);
    const proto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
    const host = opts.req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || opts.req.headers.get("host") || url.host;
    return `${proto}://${host}/auth/oidc/callback`;
}
