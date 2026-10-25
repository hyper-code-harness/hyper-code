// A small fact about the thing next to it — a state, a count, a face a module
// wears. the shared component layer's `badge`, soft so it sits inside a row without shouting.
//
// The tone is written out rather than built into the class name: a class Tailwind
// only ever sees as `badge-${tone}` is a class it never generates.
const TONE = {
    neutral: "badge-neutral", info: "badge-info", success: "badge-success",
    warning: "badge-warning", danger: "badge-error",
} as const;

/**
 * Perform badge for the ui subsystem.
 * @param opts.text The text to process.
 * @param opts.tone The tone value used by the operation.
 * @param opts.role The role value used by the operation.
 * @deprecated use w.badge
 */
export default function (ctx: Context, _session: Session | null, opts: {text: string; tone?: keyof typeof TONE; role?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<span class="badge badge-soft badge-sm ${TONE[opts.tone ?? "neutral"]}" ${ctx.fns.procs.ui.attr({ role: opts.role })}>${esc(opts.text)}</span>`;
}
