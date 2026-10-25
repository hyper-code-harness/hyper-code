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
 * @param opts.current This row is the open one.
 * @param opts.tone Danger for destructive rows.
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
    /** This row is the open one. */
    current?: boolean;
    /** Danger for destructive rows. */
    tone?: "danger";
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const lead = opts.lead ?? (opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 16 }) : "");
    const text = opts.detail
        ? `<span class="w-row-text"><span class="w-row-label">${esc(opts.label)}</span><span class="w-row-detail">${esc(opts.detail)}</span></span>`
        : `<span class="w-row-text"><span class="w-row-label">${esc(opts.label)}</span></span>`;
    const tail = `${opts.hint ? `<span class="w-row-hint">${esc(opts.hint)}</span>` : ""}${opts.dot ? `<span class="w-dot" data-state="${opts.dot}"></span>` : ""}`;
    return `<${tag} class="w-row"${tag === "div" ? " data-static" : ""}${opts.current ? ' aria-current="page"' : ""}${opts.tone ? ` data-tone="${opts.tone}"` : ""} title="${esc(opts.label)}"${attrs}>${lead ? `<span class="w-row-lead">${lead}</span>` : ""}${text}${tail}</${tag}>`;
}
