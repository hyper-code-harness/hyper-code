/**
 * People page for owners: who can sign in, how (password / Google), roles, and adding or
 * disabling people. Members get 403. Everyone in this Hyper is a trusted team member: there is no
 * isolation between users, which the page states plainly.
 */
export default async function (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const me = (session as any)?.user as types.auth.User | undefined;
    if (!me || me.role !== "owner") return new Response("Only owners can manage people", { status: 403 });
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const users = await ctx.fns.auth.listUsers({ includeDisabled: true });
    const google = await ctx.fns.auth.googleConfig({});
    const identities = await ctx.fns.procs.db.select({ sql: "SELECT user_id, provider, email FROM user_identities" }) as any[];
    const url = new URL(opts.req.url);
    const notice = url.searchParams.get("ok") ? `<div class="mb-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">${esc(url.searchParams.get("ok"))}</div>`
        : url.searchParams.get("error") ? `<div class="mb-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">${esc(url.searchParams.get("error"))}</div>` : "";
    const rows = users.map((u) => {
        const ways = [u.hasPassword ? "password" : "", ...identities.filter((i) => i.user_id === u.id).map((i) => i.provider)].filter(Boolean).join(", ") || "—";
        const self = u.id === me.id;
        const action = (name: string, label: string, extra = "") =>
            `<form method="post" action="/auth/users" class="inline"><input type="hidden" name="action" value="${name}"><input type="hidden" name="id" value="${esc(u.id)}">${extra}<button class="rounded border border-ui-border px-2 py-0.5 text-3xs hover:bg-base-200">${label}</button></form>`;
        const controls = self ? `<span class="text-3xs text-faint">you</span>` : [
            u.disabledAt ? action("enable", "Enable") : action("disable", "Disable"),
            u.role === "owner" ? action("role", "Make member", `<input type="hidden" name="role" value="member">`) : action("role", "Make owner", `<input type="hidden" name="role" value="owner">`),
        ].join(" ");
        return `<tr class="border-b border-base-200 ${u.disabledAt ? "opacity-50" : ""}" data-user="${esc(u.id)}">
  <td class="py-2 pr-3"><div class="font-medium">${esc(u.name)}</div><div class="text-3xs text-faint">${esc(u.id)}</div></td>
  <td class="py-2 pr-3 text-xs">${esc(u.email ?? "—")}</td>
  <td class="py-2 pr-3 text-xs">${esc(u.role)}${u.disabledAt ? " · disabled" : ""}</td>
  <td class="py-2 pr-3 text-xs">${esc(ways)}</td>
  <td class="py-2 text-right whitespace-nowrap">${controls}</td></tr>`;
    }).join("");
    const needsEmail = users.filter((u) => u.disabledAt == null && (!u.email || !u.hasPassword));
    const warn = needsEmail.length
        ? `<p class="mb-2 text-xs text-warning">Before adding people, give ${needsEmail.map((u) => esc(u.name)).join(", ")} an email and password (below).</p>`
        : "";
    const main = `<div class="mx-auto w-full max-w-4xl p-6">
  <h1 class="mb-1 text-lg font-semibold">People</h1>
  <p class="mb-4 text-xs text-muted">Everyone here is a trusted member of the team: all chats are visible to everyone, and every chat uses the Hyper owner's subscriptions. There is no isolation between people.</p>
  ${notice}
  <table class="mb-6 w-full text-left text-sm"><thead><tr class="border-b border-ui-border text-3xs uppercase tracking-wider text-faint"><th class="pb-1">Name</th><th class="pb-1">Email</th><th class="pb-1">Role</th><th class="pb-1">Sign-in</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  <div class="grid gap-6 sm:grid-cols-2">
    <form method="post" action="/auth/users" class="rounded-xl border border-ui-border p-4">
      <input type="hidden" name="action" value="add">
      <h2 class="mb-2 text-sm font-semibold">Add a person</h2>
      ${warn}
      <input name="name" required placeholder="Name" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <input name="email" type="email" required placeholder="Email" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <input name="password" type="password" minlength="8" ${google ? "" : "required"} placeholder="${google ? "Password (optional — can sign in with Google)" : "Password (8+ characters)"}" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <button class="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-content">Add</button>
    </form>
    <form method="post" action="/auth/users" class="rounded-xl border border-ui-border p-4">
      <input type="hidden" name="action" value="me">
      <h2 class="mb-2 text-sm font-semibold">Your account</h2>
      <input name="name" value="${esc(me.name)}" required placeholder="Name" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <input name="email" type="email" value="${esc(me.email ?? "")}" placeholder="Email" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <input name="password" type="password" minlength="8" placeholder="New password (leave empty to keep)" class="mb-2 w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm">
      <button class="rounded border border-ui-border px-3 py-1.5 text-xs font-semibold hover:bg-base-200">Save</button>
    </form>
  </div>
  <p class="mt-6 text-xs text-faint">Google sign-in: ${google ? `on, ${esc(google.domain)} accounts${google.autoCreate ? " (new accounts are added automatically)" : " (only people added here)"}` : "off"}.</p>
</div>`;
    return { title: "People", main };
}
