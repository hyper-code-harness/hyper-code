// A tab of the global menu (⌘/) — one entry of the nav.layout tabs list (the built-in `home` tab has the
// same shape). A tab is its own screen: a grid of widgets while the search box is empty, and the search
// sources it asks once the person types.
export type Tab = {
    /** Tab title. */
    title: string;
    /** Phosphor icon class. */
    icon?: string;
    /** Position among tabs, lower first. @default 100 */
    order?: number;
    /** Widgets on this tab, in grid order. */
    widgets?: types.nav.Placement[];
    /** Search source ids asked from this tab; omit for every source. */
    search?: string[];
};
