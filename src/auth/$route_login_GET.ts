/**
 * Renders sign-in: password only while there is a single user, email and password with more,
 * plus "Sign in with Google" when Google sign-in is configured. Redirects to setup when no user
 * can sign in yet.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const next = url.searchParams.get("next") || "/";
    const users = await ctx.fns.auth.listUsers({});
    const legacy = users.length === 0 && !!(await ctx.fns.auth.password({}));
    const google = await ctx.fns.auth.googleConfig({});
    const oidc = await ctx.fns.auth.oidcConfig({});
    if (!legacy && !google && !oidc && (users.length === 0 || (users.length === 1 && !users[0]!.canSignIn))) {
        return new Response(null, { status: 303, headers: { location: "/auth/setup", "cache-control": "no-store" } });
    }
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const single = users.length <= 1;
    const error = url.searchParams.get("error");
    const message = error
        ? `<p class="err">${esc(error === "1" ? `Invalid ${single ? "password" : "email or password"}.` : error)}</p>`
        : `<p>${users.length === 1 ? `Sign in as ${esc(users[0]!.name)}.` : single ? "Enter the access password." : "Sign in to continue."}</p>`;
    const showPassword = legacy || users.some((u) => u.hasPassword);
    const email = single ? "" : `<input name="email" type="email" autocomplete="username" required aria-label="Email" placeholder="Email">`;
    const passwordForm = showPassword
        ? `<input type="hidden" name="next" value="${esc(next)}">${email}<input name="password" type="password" autocomplete="current-password" required aria-label="Password" placeholder="Password"><button type="submit">Sign in</button>`
        : "";
    const googleButton = google
        ? `<a class="google" href="/auth/google?next=${encodeURIComponent(next)}" role="button">Sign in with Google <span>(${esc(google.domain)})</span></a>`
        : "";
    const oidcButton = oidc
        ? `<a class="google" href="/auth/oidc?next=${encodeURIComponent(next)}" role="button">Sign in with ${esc(oidc.label)}</a>`
        : "";
    const divider = showPassword && (google || oidc) ? `<div class="or">or</div>` : "";
    const style = `<style>.google{display:flex;align-items:center;justify-content:center;gap:.4rem;box-sizing:border-box;width:100%;min-height:46px;margin-top:1rem;border-radius:.8rem;background:#fff;color:#1f1f1f;font-weight:600;text-decoration:none}.google span{font-weight:400;color:#5f6368;font-size:.85rem}.or{text-align:center;color:#ffffff66;margin:.8rem 0 -.2rem;font-size:.85rem}</style>`;
    const body = `${style}<form method="post" action="/auth/login"><h1>Hyper</h1>${message}${oidcButton}${googleButton}${divider}${passwordForm}</form>`;
    return ctx.fns.auth.page({ title: "Sign in", body });
}
