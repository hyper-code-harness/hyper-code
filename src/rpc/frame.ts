// A view whose page is a running app (d3, its own scripts and state) keeps it in a frame: the fragment is just
// the <iframe>, sized to fill the view. Fragments themselves carry no scripts (htmx swaps them into the Hyper
// page), so this is how a `@view` brings interactive code.

/**
 * Builds the html fragment of a `@view` that shows a running page in a frame filling the view.
 *
 * Use from a `@view` function whose content is an interactive app: give `src` (a same-origin page, usually the
 * module's own route in embed mode) or `srcdoc` (a self-contained document, sandboxed). In a canvas tab the
 * framed page may post `{ hyperCanvas: 1, type: "navigate", params, replace? }` to its parent to move the tab to the same
 * view with other params (its address and ◀ ▶ history follow).
 * @param opts.src Same-origin page address (starts with `/`).
 * @param opts.srcdoc A whole html document instead of src; always sandboxed.
 * @param opts.title Accessible frame title.
 * @param opts.sandbox Sandbox tokens; srcdoc defaults to "allow-scripts", src to none (same-origin page). @default ""
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Same-origin page address (starts with `/`). */
    src?: string;
    /** A whole html document instead of src; always sandboxed. */
    srcdoc?: string;
    /** Accessible frame title. */
    title: string;
    /** Sandbox tokens; srcdoc defaults to "allow-scripts", src to none (same-origin page). @default "" */
    sandbox?: string;
}): string {
    const esc = (text: string) => ctx.fns.w.escape({ text });
    if (!opts.src === !opts.srcdoc) throw new Error("rpc.frame: give exactly one of src or srcdoc");
    if (opts.src && (!opts.src.startsWith("/") || opts.src.startsWith("//"))) throw new Error(`rpc.frame: src must be a same-origin path, got ${opts.src}`);
    const sandbox = opts.srcdoc ? (opts.sandbox || "allow-scripts") : opts.sandbox;
    const where = opts.src ? `src="${esc(opts.src)}"` : `srcdoc="${esc(opts.srcdoc!)}" referrerpolicy="no-referrer"`;
    return `<div class="rpc-frame" data-rpc-frame><iframe ${where}${sandbox ? ` sandbox="${esc(sandbox)}"` : ""} title="${esc(opts.title)}" loading="eager"></iframe></div>`;
}
