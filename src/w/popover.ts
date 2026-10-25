/**
 * Draws a trigger and a popover anchored to it (native popover + CSS anchor positioning): below the trigger or
 * beside it. Light dismiss, no client code.
 * @param opts.id Popover id (unique on the page).
 * @param opts.trigger Trusted HTML inside the trigger button.
 * @param opts.label Accessible name of the trigger.
 * @param opts.body Trusted HTML of the popover.
 * @param opts.placement Where it opens. @default "below"
 * @param opts.width Width in px. @default 280
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Popover id (unique on the page). */
    id: string;
    /** Trusted HTML inside the trigger button. */
    trigger: string;
    /** Accessible name of the trigger. */
    label: string;
    /** Trusted HTML of the popover. */
    body: string;
    /** Where it opens. @default "below" */
    placement?: "below" | "below-end" | "side";
    /** Width in px. @default 280 */
    width?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    return `<button type="button" class="w-popover-trigger" popovertarget="${id}" style="anchor-name:--${id}" title="${esc(opts.label)}" aria-label="${esc(opts.label)}">${opts.trigger}</button><div id="${id}" popover class="w-popover" data-placement="${opts.placement ?? "below"}" style="position-anchor:--${id};width:${Math.round(opts.width ?? 280)}px">${opts.body}</div>`;
}
