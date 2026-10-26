/**
 * Draws a group of list rows under a quiet title, optionally collapsible with a count.
 * @param opts.title Group title; omit for an untitled group.
 * @param opts.rows Trusted HTML of the rows (w.listRow).
 * @param opts.count Number shown after the title.
 * @param opts.collapsed Start folded (a details element). Omit for a group that cannot fold.
 * @param opts.actions Trusted HTML on the title line (a + button).
 * @param opts.attrs Behaviour hooks (w.hooks) on the group, e.g. data-* a page script reads.
 * @param opts.tone Colour of the title by meaning: info (mentions), warning (pinned). Omit for quiet grey.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Group title; omit for an untitled group. */
    title?: string;
    /** Trusted HTML of the rows (w.listRow). */
    rows: string;
    /** Number shown after the title. */
    count?: number;
    /** Start folded (a details element). Omit for a group that cannot fold. */
    collapsed?: boolean;
    /** Trusted HTML on the title line (a + button). */
    actions?: string;
    /** Colour of the title by meaning: info (mentions), warning (pinned). Omit for quiet grey. */
    tone?: "info" | "warning";
    /** Behaviour hooks (w.hooks) on the group, e.g. data-* a page script reads. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const head = opts.title ? `<span class="w-section-title">${esc(opts.title)}${opts.count !== undefined ? ` <span class="w-section-count">${opts.count}</span>` : ""}</span>${opts.actions ? `<span class="w-section-actions">${opts.actions}</span>` : ""}` : "";
    const tone = (opts.tone ? ` data-tone="${opts.tone}"` : "") + ctx.fns.w.hooks({ attrs: opts.attrs });
    if (opts.collapsed !== undefined) return `<details class="w-section"${tone}${opts.collapsed ? "" : " open"}><summary class="w-section-head">${head}</summary><div class="w-section-rows">${opts.rows}</div></details>`;
    return `<section class="w-section"${tone}>${head ? `<div class="w-section-head">${head}</div>` : ""}<div class="w-section-rows">${opts.rows}</div></section>`;
}
