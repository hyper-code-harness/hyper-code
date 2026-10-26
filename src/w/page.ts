/**
 * Draws the root of a module page: a large title, an optional lead sentence, actions on the right of the title,
 * then the body. Carries data-page, so the agent's page helpers know which screen is open. Use it for every routed
 * page instead of a hand-made h1.
 * @param opts.page Page name for the data-page automation marker, e.g. "settings".
 * @param opts.title Page title.
 * @param opts.lead Trusted HTML of one sentence under the title (what this page is for).
 * @param opts.actions Trusted HTML of the controls on the title row (w.button).
 * @param opts.body Trusted HTML of the page content.
 * @param opts.aside Trusted HTML of a side column next to the body (w.card blocks); stacks under it on narrow screens.
 * @param opts.crumbs Trusted HTML above the title (w.crumbs), the way back on a detail page.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Page name for the data-page automation marker, e.g. "settings". */
    page: string;
    /** Page title. */
    title?: string;
    /** Trusted HTML of one sentence under the title (what this page is for). */
    lead?: string;
    /** Trusted HTML of the controls on the title row (w.button). */
    actions?: string;
    /** Trusted HTML of the page content. */
    body: string;
    /** Trusted HTML of a side column next to the body (w.card blocks); stacks under it on narrow screens. */
    aside?: string;
    /** Trusted HTML above the title (w.crumbs), the way back on a detail page. */
    crumbs?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const head = opts.title || opts.lead
        ? `<header class="w-page-head"><div class="w-page-titles">${opts.title ? `<h1 class="w-page-title">${esc(opts.title)}</h1>` : ""}${opts.lead ? `<p class="w-page-lead">${opts.lead}</p>` : ""}</div>${opts.actions ? `<div class="w-page-actions">${opts.actions}</div>` : ""}</header>`
        : "";
    const body = opts.aside ? `<div class="w-page-body"><div class="w-page-main">${opts.body}</div><aside class="w-page-aside">${opts.aside}</aside></div>` : opts.body;
    return `<section class="w-page" ${ctx.fns.w.marks({ page: opts.page })}>${opts.crumbs ?? ""}${head}${body}</section>`;
}
