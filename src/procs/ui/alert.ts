// A banner — a whole message that wants attention, not the inline ui.notice. An
// icon, a title, optional body and an action. `role="alert"` and the tone from
// the state palette.
const TONE = {
    info: "alert-info", success: "alert-success",
    warning: "alert-warning", danger: "alert-error",
} as const;

/**
 * Perform alert for the ui subsystem.
 * @param opts.tone The tone value used by the operation.
 * @param opts.title The display title.
 * @param opts.text The text to process.
 * @param opts.icon The icon value used by the operation.
 * @param opts.action The action URL.
 * @deprecated use w.empty (a state in a pane) or w.toast (a note after an action)
 */
export default function (ctx: Context, _session: Session | null, opts: {tone?: keyof typeof TONE; title: string; text?: string; icon?: string; action?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const tone = opts.tone ?? "info";
    const icon = opts.icon ?? { info: "ph-info", success: "ph-check-circle", warning: "ph-warning", danger: "ph-warning-octagon" }[tone];
    return `<div class="alert ${TONE[tone]} items-start" ${ctx.fns.procs.ui.attr({ role: "alert" })}>
  <i class="ph ${esc(icon)} text-base" aria-hidden="true"></i>
  <div class="min-w-0 flex-1">
    <p class="text-sm font-medium">${esc(opts.title)}</p>
    ${opts.text ? `<p class="mt-0.5 text-xs opacity-90">${esc(opts.text)}</p>` : ""}
    ${opts.action ? `<div class="mt-2">${opts.action}</div>` : ""}
  </div>
</div>`;
}
