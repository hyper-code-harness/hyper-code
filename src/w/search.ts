/**
 * Draws a search field whose results update live as you type (htmx GET of url?q=… into target).
 * @param opts.url Endpoint answering HTML for ?q=.
 * @param opts.target Selector of the element the results replace.
 * @param opts.placeholder Hint in the empty field. @default "Search…"
 * @param opts.value Current query.
 * @param opts.id Element id of the input, for a page script that focuses it.
 * @param opts.trigger htmx trigger of the request. @default "input changed delay:200ms, search"
 * @param opts.include htmx include: selectors of other fields sent with the query (hidden state).
 * @param opts.variant boxed field in a page, or bar: the borderless header of a palette or a panel. @default "boxed"
 * @param opts.keys Shortcut shown as key caps at the right end (w.kbd), e.g. "esc".
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
    /** Element id of the input, for a page script that focuses it. */
    id?: string;
    /** htmx trigger of the request. @default "input changed delay:200ms, search" */
    trigger?: string;
    /** htmx include: selectors of other fields sent with the query (hidden state). */
    include?: string;
    /** boxed field in a page, or bar: the borderless header of a palette or a panel. @default "boxed" */
    variant?: "boxed" | "bar";
    /** Shortcut shown as key caps at the right end (w.kbd), e.g. "esc". */
    keys?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const extra = (opts.id ? ` id="${esc(opts.id)}"` : "") + (opts.include ? ` hx-include="${esc(opts.include)}"` : "") + (opts.trigger ? ' hx-sync="this:replace"' : "");
    return `<label class="w-search" data-variant="${opts.variant ?? "boxed"}">${ctx.fns.w.icon({ name: "magnifying-glass", size: 16 })}<input type="search" name="q" value="${esc(opts.value ?? "")}" placeholder="${esc(opts.placeholder ?? "Search…")}" autocomplete="off"${extra} hx-get="${esc(opts.url)}" hx-trigger="${esc(opts.trigger ?? "input changed delay:200ms, search")}" hx-target="${esc(opts.target)}" hx-swap="innerHTML">${opts.keys ? ctx.fns.w.kbd({ keys: opts.keys }) : ""}</label>`;
}
