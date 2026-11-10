/**
 * Turns the ui.newAgentActions quick actions into "+ create" menu rows drawn under New agent.
 *
 * A menu row is a link, so an href action keeps its href and an fn action opens /agent/new, whose quick-action button runs it in the popup. Returns [] when nobody answers, so the widget is unchanged. Use in a menu widget's top items.
 * @param opts.prefix Row id prefix of the widget (`chats` → `chats:quick:<id>`), keeping ids unique per widget.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Row id prefix of the widget (`chats` → `chats:quick:<id>`), keeping ids unique per widget. */
        prefix: string;
    },
): Promise<types.nav.Item[]> {
    const actions = await ctx.fns.ui.newAgentActions({}).catch(() => [] as types.ui.NewAgentAction[]);
    return actions.map(item => ({
        id: `${opts.prefix}:quick:${item.id}`,
        label: item.label,
        href: item.href ?? "/agent/new",
        icon: item.icon ?? "ph-plus",
        action: true,
    }));
}
