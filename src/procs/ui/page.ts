// The shell every module page starts with: the one element that carries
// `data-page`, the heading, and the sentence under it. Going through here is
// what makes a page addressable at all — the workspace looks for exactly one
// data-page to know what it is showing, and a page that forgets it cannot be
// pointed at, toured or reported by page.state.
// `right` is what belongs TO the heading rather than to the page under it — a
// help button, a switch over the whole screen. `ui.box` calls the same slot the
// same thing.
/**
 * Perform page for the ui subsystem.
 * @param opts.page The page value used by the operation.
 * @param opts.title The display title.
 * @param opts.lead The lead value used by the operation.
 * @param opts.right The right value used by the operation.
 * @param opts.main The main value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {page: string; title?: string; lead?: string; right?: string; main: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    // The heading is the biggest thing on the page and the sentence under it is
    // readable prose, because this pair is how somebody knows where they are.
    // They used to be 18px and 12px — a title barely louder than a table header,
    // and a lead in the size otherwise reserved for ids and timestamps — which is
    // what made a finished screen still read as a debug view.
    return `<section ${ctx.fns.procs.ui.attr({ page: opts.page })}>
${opts.title ? `<div class="flex items-center gap-2"><h1 class="text-2xl font-semibold tracking-tight">${esc(opts.title)}</h1>${opts.right ?? ""}</div>` : ""}
${opts.lead ? `<p class="mt-1.5 text-sm text-subtle">${opts.lead}</p>` : ""}
${opts.main}
</section>`;
}
