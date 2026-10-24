// One action line inside a chat panel card, drawn by the framework so every card looks the same.
// Exactly one of href, popup or post makes it clickable; with none it is a plain information line.
export type CardRow = {
    /** Phosphor icon class, for example `ph-git-fork`. */
    icon?: string;
    /** Visible text. */
    label: string;
    /** Small text at the right edge (a value, a count). */
    hint?: string;
    /** Local URL to open. */
    href?: string;
    /** Runtime function opened in the app popup, with its params (as ui.popup). */
    popup?: { method: string; params?: Record<string, unknown> };
    /** Local URL a form POSTs to (full page navigation, like the old menu's Fork and Archive). */
    post?: string;
    /** Id of a popover on the page this row opens (popovertarget), e.g. an editor drawn elsewhere in the chat. */
    popovertarget?: string;
    /** Values sent with `post` as an htmx request that swaps nothing (the page follows its own live events) instead of a full-page form post. */
    vals?: Record<string, string>;
    /** Question asked in a browser confirm() before the post is sent. */
    confirm?: string;
    /** Red text for destructive actions. @default "default" */
    tone?: "default" | "danger";
};
