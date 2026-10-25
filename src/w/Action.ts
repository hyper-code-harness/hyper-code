// What a widget does when used — one shape for every clickable widget (button, iconButton, listRow, railItem,
// menu item, tab). Exactly one of the kinds applies; the widget renders the matching element and attributes.
export type Action = {
    /** Navigate to a local URL (a link). */
    href?: string;
    /** htmx POST to this URL; the server answers and the page follows its live events. */
    post?: string;
    /** htmx GET into `target`. */
    get?: string;
    /** Values sent with post/get. */
    vals?: Record<string, string | number | boolean>;
    /** htmx target selector for get (default: this). */
    target?: string;
    /** Open a runtime function in the app popup (ui.popup, hx-popup). */
    popup?: { method: string; params?: Record<string, unknown> };
    /** Open the popover with this id. */
    popover?: string;
    /** Named client action handled by a page script (data-action). */
    action?: string;
    /** Ask before doing it (htmx confirm). */
    confirm?: string;
};
