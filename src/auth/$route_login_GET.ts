/**
 * Renders sign-in: password only while there is a single user, email and password with more.
 * Redirects to setup when no user can sign in yet.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const next = url.searchParams.get("next") || "/";
    const users = await ctx.fns.auth.listUsers({});
    const legacy = users.length === 0 && !!(await ctx.fns.auth.password({}));
    if (!legacy && (users.length === 0 || (users.length === 1 && !users[0]!.hasPassword))) {
        return new Response(null, { status: 303, headers: { location: "/auth/setup", "cache-control": "no-store" } });
    }
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const single = users.length <= 1;
    const message = url.searchParams.get("error")
        ? `<p class="err">Invalid ${single ? "password" : "email or password"}.</p>`
        : `<p>${users.length === 1 ? `Signed in as ${esc(users[0]!.name)}.` : single ? "Enter the access password." : "Sign in to continue."}</p>`;
    const email = single ? "" : `<input name="email" type="email" autocomplete="username" autofocus required aria-label="Email" placeholder="Email">`;
    const body = `<form method="post" action="/auth/login"><h1>Hyper</h1>${message}<input type="hidden" name="next" value="${esc(next)}">${email}<input name="password" type="password" autocomplete="current-password" ${single ? "autofocus" : ""} required aria-label="Password" placeholder="Password"><button type="submit">Sign in</button></form>`;
    return ctx.fns.auth.page({ title: "Sign in", body });
}
