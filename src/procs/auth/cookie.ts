// The Set-Cookie for a session, and for ending one. HttpOnly so a page script
// cannot read it, SameSite=Lax so a link from elsewhere still works but a form
// posted from elsewhere does not, Secure only over HTTPS — a Secure cookie on a
// plain-HTTP origin (e.g. http://<name>.lvh.me) is silently dropped by the
// browser, which turns a login into an endless redirect.
// `name` writes a different cookie the same way — a host that remembers one more
// thing about the browser (the patient a portal is showing) should not have to
// hand-roll Set-Cookie to get the same flags.
/**
 * Perform cookie for the auth subsystem.
 * @param opts.token The token value used by the operation.
 * @param opts.url The target URL.
 * @param opts.days The days value used by the operation.
 * @param opts.name The target name.
 */
export default function (ctx: Context, _session: Session | null, opts: { token?: string; url: string; days?: number; name?: string }): string {
    const cookies = new Bun.CookieMap();
    cookies.set({
        name: opts.name ?? ctx.fns.procs.auth.cookieName({}),
        value: opts.token ?? "",
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: /^https:/.test(opts.url),
        maxAge: opts.token ? (opts.days ?? 30) * 86400 : 0,
    });
    return cookies.toSetCookieHeaders()[0]!;
}
