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
    const { group } = opts;
    if (!group.items.length && !group.error) return "";
    const body = group.error
        ? ctx.fns.w.empty({ title: "unavailable", tone: "danger" })
        : await ctx.fns.nav.rows({ items: group.items, pinned: opts.pinned });
    return ctx.fns.w.listSection({ title: group.title, rows: body, attrs: { "data-nav-group": group.id } });
}
