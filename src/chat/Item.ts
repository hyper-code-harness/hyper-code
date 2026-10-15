// A small header element described as data — a Badge on the left or a Button on the right — drawn by the
// framework so every plugin's element has the same size, colour and tooltip.
export type Item = {
    /** Phosphor icon class, for example `ph-git-pull-request`. */
    icon: string;
    /** Short visible text; omit for an icon-only button. */
    label?: string;
    /** Tooltip and accessible name. @default label */
    title?: string;
    /** Local URL to open on click. */
    href?: string;
    /** Runtime function opened in the app popup on click, with its params (as ui.popup). */
    popup?: { method: string; params?: Record<string, unknown> };
    /** Colour: warning for an attention mark, primary for an active state. @default "default" */
    tone?: "default" | "primary" | "warning" | "danger";
};
