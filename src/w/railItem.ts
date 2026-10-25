/**
 * Draws one entry of a vertical bar: an icon (or trusted face HTML such as a chat icon) with a badge or dot and
 * a tooltip; it can be the current one.
 * @param opts.label Tooltip and accessible name.
 * @param opts.icon Phosphor icon name; ignored when face is given.
 * @param opts.face Trusted HTML drawn instead of the icon (a chat icon, an avatar).
 * @param opts.action What happens on click.
 * @param opts.badge Count on the icon.
 * @param opts.dot State dot on the icon.
 * @param opts.current This entry is the open one.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Tooltip and accessible name. */
    label: string;
    /** Phosphor icon name; ignored when face is given. */
    icon?: string;
    /** Trusted HTML drawn instead of the icon (a chat icon, an avatar). */
    face?: string;
    /** What happens on click. */
    action?: types.w.Action;
    /** Count on the icon. */
    badge?: string | number;
    /** State dot on the icon. */
    dot?: "running" | "unread" | "error" | "warning";
    /** This entry is the open one. */
    current?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" ? "button" : tag;
    const mark = opts.badge !== undefined && opts.badge !== "" && opts.badge !== 0 ? `<span class="w-badge-mark">${esc(opts.badge)}</span>` : opts.dot ? `<span class="w-dot" data-state="${opts.dot}"></span>` : "";
    return `<${t} class="w-rail-item"${opts.current ? ' aria-current="page"' : ""} title="${esc(opts.label)}" aria-label="${esc(opts.label)}"${attrs || ' type="button"'}>${opts.face ?? ctx.fns.w.icon({ name: opts.icon ?? "circle", size: 16 })}${mark}</${t}>`;
}
