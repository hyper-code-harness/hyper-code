/**
 * Renders a live page region that loads and refreshes its content over htmx
 *
 * Use for a panel whose body comes from its own GET route: it loads lazily when
 * shown, refreshes on a polling interval and/or on named client events (for
 * example ones raised by `procs.ui.respond({ trigger })`), and can be targeted by
 * id from out-of-band updates. Put a skeleton or current content in `body`.
 * @param opts.id Element id; also the name other responses use to update it.
 * @param opts.src GET URL that returns the region's inner HTML.
 * @param opts.lazy Load `src` once the region is revealed instead of rendering only `body`. @default false
 * @param opts.pollSeconds Refresh interval in seconds; omitted means no polling. @minimum 1 @maximum 3600
 * @param opts.on Client event names that refresh the region, listened for on the document body.
 * @param opts.body Trusted initial inner HTML shown before the first load. @default ""
 * @param opts.class CSS classes for the region wrapper.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Element id; also the name other responses use to update it. */
    id: string;
    /** GET URL that returns the region's inner HTML. */
    src: string;
    /** Load `src` once the region is revealed instead of rendering only `body`. @default false */
    lazy?: boolean;
    /** Refresh interval in seconds; omitted means no polling. @minimum 1 @maximum 3600 */
    pollSeconds?: number;
    /** Client event names that refresh the region, listened for on the document body. */
    on?: string[];
    /** Trusted initial inner HTML shown before the first load. @default "" */
    body?: string;
    /** CSS classes for the region wrapper. */
    class?: string;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const triggers = [
        opts.lazy ? "revealed" : "",
        opts.pollSeconds ? `every ${Math.max(1, Math.round(opts.pollSeconds))}s` : "",
        ...(opts.on ?? []).map(name => `${name} from:body`),
    ].filter(Boolean);
    const hx = triggers.length
        ? ` hx-get="${esc(opts.src)}" hx-trigger="${esc(triggers.join(", "))}" hx-swap="innerHTML"`
        : "";
    return `<div id="${esc(opts.id)}"${opts.class ? ` class="${esc(opts.class)}"` : ""} ${ctx.fns.procs.ui.attr({ section: opts.id })} aria-live="polite"${hx}>${opts.body ?? ""}</div>`;
}
