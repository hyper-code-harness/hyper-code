/**
 * Renders a small author label (colored initials + name) for a chat message, or "" when not needed.
 *
 * The color is derived from the user id, so a person always has the same color. Shown only when
 * the instance has more than one active user; a single-user Hyper looks exactly as before.
 * @param opts.userId Author user id (messages.author / events.actor); null renders nothing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Author user id (messages.author / events.actor); null renders nothing. */
        userId?: string | null;
    },
): Promise<string> {
    if (!opts.userId) return "";
    const users = await ctx.fns.auth.listUsers({ includeDisabled: true });
    if (users.filter((u) => u.disabledAt == null).length < 2) return "";
    const user = users.find((u) => u.id === opts.userId);
    const name = user?.name ?? opts.userId;
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
    let hash = 0;
    for (const ch of opts.userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    const esc = (v: string) => ctx.fns.procs.ui.escape({ text: v });
    return '<div class="mb-1 flex items-center justify-end gap-1.5 text-3xs text-muted" data-author="' + esc(opts.userId) + '">'
        + '<span>' + esc(name) + '</span>'
        + '<span class="inline-flex size-5 items-center justify-center rounded-full text-[0.6rem] font-semibold text-white" style="background:hsl(' + hue + ' 55% 45%)" aria-hidden="true">' + esc(initials) + '</span>'
        + '</div>';
}
