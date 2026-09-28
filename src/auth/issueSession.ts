/**
 * Signs a session token for a user and returns the Set-Cookie header value.
 *
 * Shared by sign-in and setup so both issue identical cookies; marks the cookie Secure
 * behind an HTTPS tunnel that sends X-Forwarded-Proto.
 * @param opts.user User to sign in.
 * @param opts.req Incoming request, used to pick the cookie's security flags.
 * @param opts.days Session lifetime in days. @default 30
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User to sign in. */
        user: types.auth.User;
        /** Incoming request, used to pick the cookie's security flags. */
        req: Request;
        /** Session lifetime in days. @default 30 */
        days?: number;
    },
): Promise<string> {
    const days = opts.days ?? 30;
    const token = await ctx.fns.procs.auth.sign({ sub: opts.user.id, name: opts.user.name, email: opts.user.email ?? undefined, role: opts.user.role, days });
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookieURL = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
    return ctx.fns.procs.auth.cookie({ token, url: cookieURL, days });
}
