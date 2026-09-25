// How far along — questions answered, a score against a max. The bar tints with
// the tone; `data-role="progress"` and the aria values carry the number.
// No tone is the neutral "how far along" bar, so it stays the primary colour the
// old one had rather than becoming an informational blue.
const TONE = {
    default: "progress-primary", info: "progress-info", success: "progress-success",
    warning: "progress-warning", danger: "progress-error",
} as const;

/**
 * Perform progress for the ui subsystem.
 * @param opts.value The value to apply.
 * @param opts.max The max value used by the operation.
 * @param opts.label The display label.
 * @param opts.tone The tone value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {value: number; max?: number; label?: string; tone?: keyof typeof TONE; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const max = opts.max ?? 100;
    return `<div class="${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: "progress" })}>
  ${opts.label ? `<div class="text-subtle mb-1 flex justify-between text-xs"><span>${esc(opts.label)}</span><span>${opts.value}/${max}</span></div>` : ""}
  <progress class="progress ${TONE[opts.tone ?? "default"]} w-full" value="${opts.value}" max="${max}"></progress>
</div>`;
}
