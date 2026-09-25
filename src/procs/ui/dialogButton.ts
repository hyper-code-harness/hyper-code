/**
 * Renders a button that opens a `procs.ui.dialog` by id
 *
 * Use as the trigger for a dialog rendered with `procs.ui.dialog`; it carries
 * `data-dialog-open` so the shared client script opens the dialog without inline JS.
 * @param opts.dialog Id of the dialog to open.
 * @param opts.label Visible button label.
 * @param opts.icon Optional Phosphor icon class such as `ph-plus`.
 * @param opts.tone Button tone. @default default
 * @param opts.action Stable data-action name for automation. @default open-dialog
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Id of the dialog to open. */
    dialog: string;
    /** Visible button label. */
    label: string;
    /** Optional Phosphor icon class such as `ph-plus`. */
    icon?: string;
    /** Button tone. @default default */
    tone?: "default" | "primary" | "success" | "ghost";
    /** Stable data-action name for automation. @default open-dialog */
    action?: string;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    return ctx.fns.procs.ui.button({
        action: opts.action ?? "open-dialog",
        html: `${opts.icon ? `<i class="ph ${esc(opts.icon)}" aria-hidden="true"></i>` : ""}${esc(opts.label)}`,
        tone: opts.tone ?? "default",
        attrs: { "data-dialog-open": opts.dialog, "aria-haspopup": "dialog" },
    });
}
