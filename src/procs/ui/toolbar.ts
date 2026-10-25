// The bar above a list — something on the left (a title, a filter), actions on
// the right. Wraps under pressure; carries no markers of its own, it is a frame.
/**
 * Perform toolbar for the ui subsystem.
 * @param opts.left The left value used by the operation.
 * @param opts.right The right value used by the operation.
 * @param opts.class CSS classes to apply.
 * @deprecated use w.toolbar
 */
export default function (_ctx: Context, _session: Session | null, opts: { left?: string; right?: string; class?: string }): string {
    return `<div class="flex flex-wrap items-center justify-between gap-3 ${opts.class ?? ""}">
  <div class="flex min-w-0 items-center gap-2">${opts.left ?? ""}</div>
  <div class="flex shrink-0 items-center gap-2">${opts.right ?? ""}</div>
</div>`;
}
