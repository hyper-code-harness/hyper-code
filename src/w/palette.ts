/**
 * Draws a command palette: a full-window overlay over the app with a search bar on top, a scrolling body and a
 * quiet footer of keyboard hints. It starts hidden; a page script shows it by removing the `hidden` attribute.
 * Use it for the global menu (⌘/) and any other "type to find, arrows to pick" surface that covers the window.
 * @param opts.id Element id of the overlay (the script toggles its `hidden` attribute).
 * @param opts.label Accessible name of the dialog, e.g. "Global menu".
 * @param opts.head Trusted HTML of the top bar, usually w.search with variant "bar".
 * @param opts.body Trusted HTML shown first in the scrolling body (a spinner until the results arrive).
 * @param opts.bodyId Element id of the scrolling body, the htmx target of the search.
 * @param opts.hints Keyboard hints in the footer: one or several shortcuts (w.kbd each) and what they do; an `end` hint sits at the right edge.
 * @param opts.open Render it open (no hidden attribute). @default false
 * @param opts.attrs Behaviour hooks (w.hooks) on the overlay, e.g. onclick to close on a backdrop click.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Element id of the overlay (the script toggles its `hidden` attribute). */
    id: string;
    /** Accessible name of the dialog, e.g. "Global menu". */
    label: string;
    /** Trusted HTML of the top bar, usually w.search with variant "bar". */
    head: string;
    /** Trusted HTML shown first in the scrolling body (a spinner until the results arrive). */
    body?: string;
    /** Element id of the scrolling body, the htmx target of the search. */
    bodyId?: string;
    /** Keyboard hints in the footer: one or several shortcuts (w.kbd each) and what they do; an `end` hint sits at the right edge. */
    hints?: Array<{ keys: string | string[]; label: string; end?: boolean }>;
    /** Render it open (no hidden attribute). @default false */
    open?: boolean;
    /** Behaviour hooks (w.hooks) on the overlay, e.g. onclick to close on a backdrop click. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const hints = (opts.hints ?? []).map(h => `<span class="w-palette-hint"${h.end ? " data-end" : ""}>${(Array.isArray(h.keys) ? h.keys : [h.keys]).map(k => ctx.fns.w.kbd({ keys: k })).join("")}${esc(h.label)}</span>`).join("");
    return `<div class="w-palette" id="${esc(opts.id)}"${opts.open ? "" : " hidden"}${ctx.fns.w.hooks({ attrs: opts.attrs })}>`
        + `<div class="w-palette-box" role="dialog" aria-modal="true" aria-label="${esc(opts.label)}">`
        + `<div class="w-palette-head">${opts.head}</div>`
        + `<div class="w-palette-body"${opts.bodyId ? ` id="${esc(opts.bodyId)}"` : ""}>${opts.body ?? ""}</div>`
        + (hints ? `<div class="w-palette-foot">${hints}</div>` : "")
        + `</div></div>`;
}
