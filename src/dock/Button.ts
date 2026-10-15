// A Dock button described as data, drawn by the framework so every entry looks the same.
export type Button = {
    /** Phosphor icon class, for example `ph-envelope`. */
    icon: string;
    /** Tooltip and accessible name. */
    label: string;
    /** Local URL to open on click; omit when `popup` is given. */
    href?: string;
    /** Small counter or mark on the icon; null, 0 and "" show none. */
    badge?: number | string | null;
    /** Trusted HTML shown in a popover beside the Dock instead of navigating. */
    popup?: string;
};
