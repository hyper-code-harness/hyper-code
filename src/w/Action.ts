// What a widget does when used — one shape for every clickable widget (button, iconButton, listRow, railItem,
// menu item, tab). Exactly one kind must be set (w.actionAttrs throws otherwise); the widget renders the matching
// element. Request semantics are explicit: a post swaps nothing unless you give target + swap; a get needs a target.
export type Action = {
    /** Navigate to a local path or an http(s) URL (a link). */
    href?: string;
    /** htmx POST to this URL; by default nothing is swapped and the page follows its live events. */
    post?: string;
    /** htmx GET into `target` (required with get). */
    get?: string;
    /** Values sent with post/get. */
    vals?: Record<string, string | number | boolean>;
    /** htmx target selector for post/get. */
    target?: string;
    /** htmx swap for post/get. @default "none" for post, "innerHTML" for get */
    swap?: "none" | "innerHTML" | "outerHTML" | "beforeend" | "afterbegin" | "beforebegin" | "afterend";
    /** Open a runtime function in the app popup (ui.popup, hx-popup). */
    popup?: { method: string; params?: Record<string, unknown> };
    /** Open the popover (or menu) with this id; the element becomes its anchor. */
    popover?: string;
    /** Named client action handled by a page script (data-action). */
    action?: string;
    /** Ask before doing it — for every kind (htmx confirm). */
    confirm?: string;
};
