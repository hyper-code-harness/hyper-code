// One Dock entry — what a `$dock_<name>.ts` file default-exports (a `$dock_<name>.json` holds the
// same fields without `render`).
//
// The framework owns the Dock: the fixed global-menu button at the very top, the signed-in person at
// the very bottom, the two zones between them, the order and what is hidden. An entry owns only what
// is specific to it: where it would like to be by default and what it draws.

export type Item = {
    /** Zone the entry goes to unless the layout says otherwise. @default "top" */
    zone?: "top" | "bottom";
    /** Position inside the zone, lower first; ties are broken by id. @default 100 */
    order?: number;
    /** Phosphor icon class for a plain link entry, for example `ph-newspaper`. */
    icon?: string;
    /** Tooltip and accessible name of a plain link entry. */
    label?: string;
    /** Local URL a plain link entry opens. */
    href?: string;
    /** Draws the entry for this request: trusted HTML, a button description, or null/"" to show nothing.
     *  Runs on every page render with a short timeout; a throw or a timeout only hides this entry. */
    render?: (ctx: Context, session: Session | null) => string | types.dock.Button | null | Promise<string | types.dock.Button | null>;
};
