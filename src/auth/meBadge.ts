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
    const esc = (v: string) => ctx.fns.procs.ui.escape({ text: v });
    const users = await ctx.fns.auth.listUsers({});
    const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
    let hash = 0;
    for (const ch of user.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    const people = user.role === "owner"
        ? `<a href="/auth/users" class="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-200"><i class="ph ph-users"></i>People${users.length > 1 ? ` <span class="ml-auto text-faint">${users.length}</span>` : ""}</a>`
        : "";
    return `<details id="me-menu" class="relative mb-1">
  <summary class="flex size-7 cursor-pointer list-none items-center justify-center rounded-full text-[0.6rem] font-semibold text-white" style="background:hsl(${hue} 55% 45%)" title="${esc(user.name)}" aria-label="Account: ${esc(user.name)}">${esc(initials)}</summary>
  <div class="absolute bottom-0 left-full z-50 ml-2 w-56 rounded-xl border border-ui-border bg-base-100 p-1.5 shadow-xl">
    <div class="border-b border-ui-border px-2 pb-1.5 pt-1"><div class="truncate text-xs font-semibold">${esc(user.name)}</div><div class="truncate text-3xs text-faint">${esc(user.email ?? user.id)}${user.role === "owner" ? " · owner" : ""}</div></div>
    ${people}
    <form method="post" action="/auth/logout"><button type="submit" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-base-200"><i class="ph ph-sign-out"></i>Sign out</button></form>
  </div>
</details>`;
}
