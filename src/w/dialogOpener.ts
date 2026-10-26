/**
 * Draws a w.button that opens a w.dialog by id (native showModal, no script per page). Use it as the page action
 * that starts a dialog form, e.g. "New task".
 * @param opts.dialog Id of the w.dialog to open.
 * @param opts.label Button text.
 * @param opts.icon Icon name before the label.
 * @param opts.tone Button tone.
 * @param opts.action data-action automation marker.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Id of the w.dialog to open. */
    dialog: string;
    /** Button text. */
    label: string;
    /** Icon name before the label. */
    icon?: string;
    /** Button tone. @default "neutral" */
    tone?: "neutral" | "primary" | "success";
    /** data-action automation marker. @default "open-dialog" */
    action?: string;
}): string {
    const id = String(opts.dialog).replace(/[^a-zA-Z0-9_-]/g, "-");
    return ctx.fns.w.button({ label: opts.label, icon: opts.icon, tone: opts.tone ?? "neutral", marks: { action: opts.action ?? "open-dialog" }, attrs: { "data-dialog-open": id, "aria-haspopup": "dialog" } });
}
