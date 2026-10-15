// A widget type — what a `$widget_<name>.ts` file default-exports. The person places it on a tab of the
// global menu (⌘/) as many times as they like, each placement with its own size and config.
//
// The framework owns the grid, the tile frame, its title, loading/error states and keys; the widget owns
// only what is inside. Keep render a cached read: it runs when the menu opens, with a short timeout.
export type Widget = {
    /** Tile title and the name in the widget catalogue. */
    title: string;
    /** Phosphor icon class for the title and the catalogue, for example `ph-calendar`. */
    icon?: string;
    /** One-line explanation shown in the widget catalogue. */
    description?: string;
    /** Sizes the widget can draw, first is the default. @default ["M"] */
    sizes?: types.nav.Size[];
    /** Settings one placement may set, by name; render receives them merged over the defaults. */
    config?: Record<string, { type: "string" | "number" | "boolean"; default?: string | number | boolean; description?: string }>;
    /** Seconds the drawn tile may be reused for the same person, size and config. @default 0 */
    ttl?: number;
    /** Draws the tile: rows as Item[] (drawn by the framework), trusted HTML, or both; null shows "empty". */
    render: (ctx: Context, session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }) =>
        types.nav.WidgetOutput | types.nav.Item[] | string | null | Promise<types.nav.WidgetOutput | types.nav.Item[] | string | null>;
};
