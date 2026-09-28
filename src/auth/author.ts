/**
 * Returns how to show the author of a chat message: name, initials, a stable color and profile photo.
 *
 * Returns null when no author should be shown: no user id, or a single-user local Hyper (fewer than
 * two active users and no control-plane sign-in), so such an instance looks exactly as before.
 * The photo comes from the sign-in ID token's `picture` claim (https only). Use when rendering
 * user messages; `auth.badge` is the compact label form.
 * @param opts.userId Author user id (messages.author / events.actor); null returns null.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Author user id (messages.author / events.actor); null returns null. */
        userId?: string | null;
    },
): Promise<{ id: string; name: string; initials: string; hue: number; picture: string | null } | null> {
    if (!opts.userId) return null;
    const users = await ctx.fns.auth.listUsers({ includeDisabled: true });
    const shared = users.filter((u) => u.disabledAt == null).length >= 2
        || !!String((await ctx.fns.settings.get({ module: "auth", scopeType: "global", key: "oidcIssuer" })) ?? "").trim();
    if (!shared) return null;
    const user = users.find((u) => u.id === opts.userId);
    const name = user?.name ?? opts.userId;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
    let hash = 0;
    for (const ch of opts.userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return { id: opts.userId, name, initials, hue: hash % 360, picture: user?.picture ?? null };
}
