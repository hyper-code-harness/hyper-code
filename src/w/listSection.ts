/**
 * Draws a group of list rows under a quiet title, optionally collapsible with a count.
 * @param opts.title Group title; omit for an untitled group.
 * @param opts.rows Trusted HTML of the rows (w.listRow).
 * @param opts.count Number shown after the title.
 * @param opts.collapsed Start folded (a details element). Omit for a group that cannot fold.
 * @param opts.actions Trusted HTML on the title line (a + button).
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
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const head = opts.title ? `<span class="w-section-title">${esc(opts.title)}${opts.count !== undefined ? ` <span class="w-section-count">${opts.count}</span>` : ""}</span>${opts.actions ? `<span class="w-section-actions">${opts.actions}</span>` : ""}` : "";
    if (opts.collapsed !== undefined) return `<details class="w-section"${opts.collapsed ? "" : " open"}><summary class="w-section-head">${head}</summary><div class="w-section-rows">${opts.rows}</div></details>`;
    return `<section class="w-section">${head ? `<div class="w-section-head">${head}</div>` : ""}<div class="w-section-rows">${opts.rows}</div></section>`;
}
