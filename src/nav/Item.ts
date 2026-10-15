// One row the global menu (⌘/) shows: a destination in the palette, a line inside a widget, or a search result.
// The menu draws every row itself from this shape (nav.rows), so keys (⌘J/⌘K, ↵, ⌘↵) and 📌 work the same
// for all plugins.
export type Item = {
    /** Stable, namespaced id (`knowledge:person/42`); keeps the selection in place while results arrive. */
    id?: string;
    label: string;
    href: string;
    /** Short text at the right edge (a kind, a count, an id). */
    hint?: string;
    /** Second line under the label (an excerpt, a description). */
    detail?: string;
    /** Optional Phosphor icon class, for example `ph-clock`. */
    icon?: string;
    /** Draw this model's logo instead of an icon (chat rows), spinning while `active`. */
    model?: string;
    /** The chat's own avatar SVG (agents.icon), drawn instead of the model logo (with `model`). */
    avatar?: string;
    /** The chat is running right now (with `model`). */
    active?: boolean;
    /** Show a dot for news the person has not seen. */
    unread?: boolean;
    /** Name of another person who owns the row, shown small at the right. */
    owner?: string;
    /** Menu section such as System, Projects & files, or Plugins (declared `$app_` pages). */
    group?: string;
    /** Stable order among declarative app destinations. */
    order?: number;
    /** A page declared by a plugin rather than the core (declared `$app_` pages). */
    plugin?: boolean;
    /** What 📌 toggles: `page:<href>` (Dock page) or `agent:<id>` (pinned chat); omit when the row cannot be pinned. */
    pin?: string;
};
