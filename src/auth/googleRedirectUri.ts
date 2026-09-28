/**
 * Returns the absolute Google OAuth redirect URI for this Hyper: <origin>/auth/google/callback.
 *
 * Honors X-Forwarded-Proto/-Host behind a tunnel so the URI matches what the browser used; this
 * exact value must be registered on the OAuth client.
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
    return `${proto}://${host}/auth/google/callback`;
}
