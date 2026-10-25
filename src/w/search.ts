/**
 * Draws a search field whose results update live as you type (htmx GET of url?q=… into target).
 * @param opts.url Endpoint answering HTML for ?q=.
 * @param opts.target Selector of the element the results replace.
 * @param opts.placeholder Hint in the empty field. @default "Search…"
 * @param opts.value Current query.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Endpoint answering HTML for ?q=. */
    url: string;
    /** Selector of the element the results replace. */
    target: string;
    /** Hint in the empty field. @default "Search…" */
    placeholder?: string;
    /** Current query. */
    value?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    return `<label class="w-search">${ctx.fns.w.icon({ name: "magnifying-glass", size: 14 })}<input type="search" name="q" value="${esc(opts.value ?? "")}" placeholder="${esc(opts.placeholder ?? "Search…")}" autocomplete="off" hx-get="${esc(opts.url)}" hx-trigger="input changed delay:200ms, search" hx-target="${esc(opts.target)}" hx-swap="innerHTML"></label>`;
}
