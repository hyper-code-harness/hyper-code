// A placeholder while something loads — grey bars that shimmer. Pair it with an
// htmx hx-indicator so it shows only during a request.
/**
 * Perform skeleton for the ui subsystem.
 * @param opts.lines The lines value used by the operation.
 * @param opts.class CSS classes to apply.
 * @deprecated use w.spinner with kind "skeleton"
 */
export default function (ctx: Context, _session: Session | null, opts?: { lines?: number; class?: string }): string {
    const n = opts?.lines ?? 3;
    return `<div class="space-y-2 ${opts?.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: "skeleton" })} aria-hidden="true">
  ${Array.from({ length: n }, (_, i) => `<div class="skeleton h-3" style="width:${[100, 80, 90, 70][i % 4]}%"></div>`).join("")}
</div>`;
}
