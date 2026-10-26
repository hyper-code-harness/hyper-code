/**
 * Draws a popover panel anchored to the element that opens it (native popover + CSS anchor positioning): below
 * it, below and right-aligned, or beside it. Light dismiss, no client code. The opener is any widget with
 * `action: { popover: id }` — pass it as `trigger` to draw both together, or place it elsewhere.
 * @param opts.id Popover id (unique on the page).
 * @param opts.body Trusted HTML of the panel.
 * @param opts.trigger Trusted HTML of the opener (a widget with action { popover: id }), drawn before the panel.
 * @param opts.label Accessible name of the panel.
 * @param opts.placement Where it opens. @default "below"
 * @param opts.width Width in px. @default 280
 * @param opts.attrs Behaviour hooks on the panel (w.hooks): data-*, aria-* — e.g. a URL a page script loads the body from.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Popover id (unique on the page). */
    id: string;
    /** Trusted HTML of the panel. */
    body: string;
    /** Trusted HTML of the opener (a widget with action { popover: id }), drawn before the panel. */
    trigger?: string;
    /** Accessible name of the panel. */
    label?: string;
    /** Where it opens. @default "below" */
    placement?: "below" | "below-end" | "side";
    /** Width in px. @default 280 */
    width?: number;
    /** Behaviour hooks on the panel (w.hooks): data-*, aria-* — e.g. a URL a page script loads the body from. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    return `${opts.trigger ?? ""}<div id="${id}" popover class="w-popover" role="dialog"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""} data-placement="${opts.placement ?? "below"}"${ctx.fns.w.hooks({ attrs: opts.attrs })} style="position-anchor:--${id};width:${Math.round(opts.width ?? 280)}px">${opts.body}</div>`;
}
