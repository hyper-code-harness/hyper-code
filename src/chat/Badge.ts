// A left-side header element — what a `$chatbadge_<name>.ts` file default-exports. Badges say something about
// the chat (its folder, its parent, its state); they sit right after the name.
//
// The framework owns the header: the icon, the name, the order and what is hidden (setting chat.layout).
// A badge owns only what it draws. Keep render a cached read: it runs on every chat render with a 1.5 s timeout,
// and a throw, a timeout or null only leaves this badge out.
export type Badge = {
    /** Position among the badges, lower first; ties are broken by id. @default 100 */
    order?: number;
    /** Draws the badge: trusted HTML, an item description (types.chat.Item), or null/"" to show nothing. */
    render: (ctx: Context, session: Session | null, context: types.chat.RenderContext) => string | types.chat.Item | null | Promise<string | types.chat.Item | null>;
};
