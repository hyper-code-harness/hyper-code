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
    // Native top-layer popover (ui.inplacePopup): never covered by the chat area, no z-index games.
    const face = user.picture
        ? `<img src="${esc(user.picture)}" alt="" class="size-7 rounded-full object-cover" referrerpolicy="no-referrer">`
        : `<span class="flex size-7 items-center justify-center rounded-full text-[0.6rem] font-semibold text-white" style="background:hsl(${hue} 55% 45%)">${esc(initials)}</span>`;
    const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-base-200 hover:text-base-content";
    return `<div class="mb-1">` + await ctx.fns.ui.inplacePopup({
        id: "me-menu",
        triggerHtml: face,
        triggerAttrs: `class="flex size-7 items-center justify-center rounded-full" title="${esc(user.name)}" aria-label="Account: ${esc(user.name)}"`,
        panelAttrs: `aria-label="Account" data-placement="side"`,
        contentHtml: `<div class="flex flex-col">
    <div class="mb-1 border-b border-ui-border px-2 pb-1.5 pt-0.5"><div class="truncate text-xs font-semibold">${esc(user.name)}</div><div class="truncate text-3xs text-faint">${esc(user.email ?? user.id)}${user.role === "owner" ? " · owner" : ""}</div></div>
    ${user.role === "owner" ? `<a href="/auth/users" class="${item}"><i class="ph ph-users" aria-hidden="true"></i>People${users.length > 1 ? ` <span class="ml-auto text-faint">${users.length}</span>` : ""}</a>` : ""}
    <form method="post" action="/auth/logout" hx-boost="false"><button type="submit" class="${item}"><i class="ph ph-sign-out" aria-hidden="true"></i>Sign out</button></form>
  </div>`,
    }) + `</div>`;
}
