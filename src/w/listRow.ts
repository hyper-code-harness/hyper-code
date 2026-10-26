/**
 * Draws one row of a list — the menu, the side panel, panel cards, search results: a lead (icon, chat icon,
 * avatar), a label with an optional second line, and a quiet tail (hint, state dot, pin) on the right.
 * @param opts.label Main text.
 * @param opts.detail Second line under the label.
 * @param opts.icon Phosphor icon name as the lead; ignored when lead is given.
 * @param opts.lead Trusted HTML lead (a chat icon, an avatar).
 * @param opts.hint Quiet text on the right.
 * @param opts.dot State dot on the right.
 * @param opts.action What happens on click.
 * @param opts.current This row is the open one (blue: selected).
 * @param opts.selected This row is chosen with the keyboard or in a multi-select (blue: selected).
 * @param opts.tone danger for destructive rows, primary for the "+ create" row at the top of a list (blue text).
 * @param opts.meta Quiet monospace text right after the label (a short id such as "(da)").
 * @param opts.end Trusted HTML beside the row that shows on hover or focus (a w.iconButton such as a pin); it sits
 *   outside the row's link, so a button is never nested in a link.
 * @param opts.attrs Behaviour hooks (w.hooks) on the row itself: data-*, aria-*, id.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Main text. */
    label: string;
    /** Second line under the label. */
    detail?: string;
    /** Phosphor icon name as the lead; ignored when lead is given. */
    icon?: string;
    /** Trusted HTML lead (a chat icon, an avatar). */
    lead?: string;
    /** Quiet text on the right. */
    hint?: string;
    /** State dot on the right. */
    dot?: "running" | "unread" | "error" | "warning";
    /** What happens on click. */
    action?: types.w.Action;
    /** This row is the open one (blue: selected). */
    current?: boolean;
    /** This row is chosen with the keyboard or in a multi-select (blue: selected). */
    selected?: boolean;
    /** danger for destructive rows, primary for the "+ create" row at the top of a list (blue text). */
    tone?: "danger" | "primary";
    /** Quiet monospace text right after the label (a short id such as "(da)"). */
    meta?: string;
    /** Trusted HTML beside the row that shows on hover or focus (a w.iconButton such as a pin). */
    end?: string;
    /** Behaviour hooks (w.hooks) on the row itself: data-*, aria-*, id. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const lead = opts.lead ?? (opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 16 }) : "");
    const label = `<span class="w-row-label">${esc(opts.label)}${opts.meta ? ` <span class="w-row-meta">${esc(opts.meta)}</span>` : ""}</span>`;
    const text = `<span class="w-row-text">${label}${opts.detail ? `<span class="w-row-detail">${esc(opts.detail)}</span>` : ""}</span>`;
    const tail = `${opts.hint ? `<span class="w-row-hint">${esc(opts.hint)}</span>` : ""}${opts.dot ? `<span class="w-dot" data-state="${opts.dot}"></span>` : ""}`;
    const row = `<${tag} class="w-row"${tag === "div" ? " data-static" : ""}${opts.current ? ' aria-current="page"' : ""}${opts.selected ? ' aria-selected="true"' : ""}${opts.tone ? ` data-tone="${opts.tone}"` : ""} title="${esc(opts.label)}"${ctx.fns.w.hooks({ attrs: opts.attrs })}${attrs}>${lead ? `<span class="w-row-lead">${lead}</span>` : ""}${text}${tail}</${tag}>`;
    return opts.end ? `<div class="w-row-wrap">${row}<span class="w-row-end">${opts.end}</span></div>` : row;
}
