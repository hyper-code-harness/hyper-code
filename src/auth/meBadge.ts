/**
 * Renders the signed-in person's avatar button for the quick bar, with a small menu:
 * name and email, "People" for owners, and sign out.
 *
 * Returns "" when nobody is signed in (open local instance without users), so a single-user Hyper
 * without sign-in looks exactly as before.
 */
export default async function (ctx: Context, session: Session | null, _opts: {}): Promise<string> {
    const user = (session as any)?.user as types.auth.User | undefined;
    if (!user) return "";
    const users = await ctx.fns.auth.listUsers({});
    const w = ctx.fns.w;
    const face = await w.avatar({ name: user.name, src: user.picture ?? undefined, size: 24 });
    const who = w.listRow({ label: user.name, detail: `${user.email ?? user.id}${user.role === "owner" ? " · owner" : ""}` });
    const people = user.role === "owner" ? w.listRow({ label: "People", icon: "users", hint: users.length > 1 ? String(users.length) : undefined, action: { href: "/auth/users" } }) : "";
    // Sign out is a real form POST (the route answers with a redirect to the sign-in page), not an htmx request;
    // the row looks like every other menu row and submits its form.
    const signOut = `<form method="post" action="/auth/logout" hx-boost="false">${w.listRow({ label: "Sign out", icon: "sign-out", action: { action: "sign-out" }, attrs: { onclick: "this.closest('form').requestSubmit()" } })}</form>`;
    return w.popover({ id: "me-menu", label: "Account", placement: "side", width: 240,
        body: w.list({ body: who + w.divider({}) + people + signOut }),
        trigger: w.railItem({ label: `Account: ${user.name}`, face, action: { popover: "me-menu" } }) });
}
