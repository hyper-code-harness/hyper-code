// What went wrong, or what just worked. One shape for both so a page does not
// invent its own each time. It carries `data-role="notice"` and `data-tone`
// (success/danger/warning/info), so an agent that pressed a button and stayed on
// the page reads the result off the notice — `page.text({ role: "notice" })`, or
// `page.state().notices`. This is distinct from a field's validation error,
// which is `data-role="error"` inside `[data-field][data-invalid]`.
const TONE = {
    info: "alert-info", success: "alert-success",
    warning: "alert-warning", danger: "alert-error",
} as const;

/**
 * Perform notice for the ui subsystem.
 * @param opts.text The text to process.
 * @param opts.tone The tone value used by the operation.
 * @deprecated use w.toast
 */
export default function (ctx: Context, _session: Session | null, opts: {text: string; tone?: keyof typeof TONE }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const tone = opts.tone ?? "info";
    return `<div class="alert alert-soft ${TONE[tone]} py-2 text-sm" ${ctx.fns.procs.ui.attr({ role: "notice" })} data-tone="${tone}">${esc(opts.text)}</div>`;
}
