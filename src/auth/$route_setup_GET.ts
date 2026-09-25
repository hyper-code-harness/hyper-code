/**
 * Renders first-user setup: confirm your name, optionally email and password.
 *
 * Available while there are no users, or while the lone user was seeded (from env or the
 * legacy password) without a confirmed name. Otherwise redirects home.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const users = await ctx.fns.auth.listUsers({});
    const lone = users.length === 1 ? users[0]! : null;
    if (users.length > 1 || (lone && lone.configuredAt != null)) return new Response(null, { status: 303, headers: { location: "/" } });
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const guess = lone?.name && lone.name !== "Owner" ? lone.name : String(ctx.env.HYPER_USER ?? ctx.env.USER ?? "");
    const needsCurrent = !!lone?.hasPassword;
    const error = new URL(opts.req.url).searchParams.get("error");
    const body = `<form method="post" action="/auth/setup"><h1>Welcome to Hyper</h1>
<p>${needsCurrent ? "Your existing password stays the same. Confirm who you are." : "Tell Hyper who you are."}</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
${needsCurrent ? `<label>Current password<input name="current" type="password" required autocomplete="current-password" autofocus></label>` : ""}
<label>Your name<input name="name" required value="${esc(guess)}" ${needsCurrent ? "" : "autofocus"}></label>
<label>Email (optional)<input name="email" type="email" value="${esc(lone?.email ?? "")}" autocomplete="email"></label>
${needsCurrent ? "" : `<label>Password (optional — without one, Hyper opens without sign-in)<input name="password" type="password" minlength="8" autocomplete="new-password"></label>`}
<button type="submit">Continue</button></form>`;
    return ctx.fns.auth.page({ title: "Setup", body });
}
