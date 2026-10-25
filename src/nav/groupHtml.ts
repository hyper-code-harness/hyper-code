/**
 * Draws one search source's group for the global menu: its title and rows (nav.rows), a one-line
 * "unavailable" note when the source failed, nothing when it found nothing.
 * @param opts.group The source's answer.
 * @param opts.pinned Pin ids currently pinned (`agent:<id>`, `page:<href>`).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** The source's answer. */
        group: { id: string; title: string; items: types.nav.Item[]; error?: string };
        /** Pin ids currently pinned (`agent:<id>`, `page:<href>`). */
        pinned?: Set<string>;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const { group } = opts;
    if (!group.items.length && !group.error) return "";
    const body = group.error
        ? `<div class="px-2 py-1 text-3xs text-faint">unavailable</div>`
        : await ctx.fns.nav.rows({ items: group.items, pinned: opts.pinned });
    return `<section data-nav-group="${esc(group.id)}" class="mb-2"><h4 class="mb-0.5 px-1.5 text-3xs font-semibold uppercase tracking-wider text-faint">${esc(group.title)}</h4>${body}</section>`;
}
