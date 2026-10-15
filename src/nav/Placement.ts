// One widget placed on a menu tab: which widget type, how big, with which settings.
export type Placement = {
    /** Unique within the tab; a widget type may be placed several times. */
    id: string;
    /** Widget type id, `<module>.<name>` of a `$widget_` file (bare `<name>` for the nav module's own). */
    widget: string;
    /** Tile size; must be one the widget declares, else its first. */
    size?: types.nav.Size;
    /** Settings for this placement, merged over the widget's declared defaults. */
    config?: Record<string, unknown>;
};
