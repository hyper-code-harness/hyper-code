// What a widget draws. Rows (items, sections) are rendered by the framework as ordinary menu rows, so the
// keyboard, ↵, ⌘↵ and 📌 work on them; html is for content that is not a list (a number, a chart, a button).
export type WidgetOutput = {
    /** Trusted HTML drawn first. Rows inside it should come from ctx.fns.nav.rows to stay keyboard-navigable. */
    html?: string;
    /** Rows drawn after html. */
    items?: types.nav.Item[];
    /** Titled groups of rows drawn after items; `collapsed` puts the group in a closed disclosure. */
    /** Lay sections out side by side in columns (wide tiles) instead of one under another. @default false */
    columns?: boolean;
    sections?: Array<{ title: string; items?: types.nav.Item[]; html?: string; tone?: "primary" | "warning"; collapsed?: boolean; count?: number }>;
};
