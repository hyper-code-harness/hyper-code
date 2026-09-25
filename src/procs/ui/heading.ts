// A section heading with its actions on the right — the title of a thing and
// the buttons that act on it, on one line that wraps under pressure.
/**
 * Perform heading for the ui subsystem.
 * @param opts.title The display title.
 * @param opts.meta Additional metadata.
 * @param opts.actions The actions value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {title: string; meta?: string; actions?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<div class="flex flex-wrap items-center justify-between gap-3">
  <div class="min-w-0">
    <h2 class="text-base font-semibold text-base-content">${esc(opts.title)}</h2>
    ${opts.meta ? `<p class="mt-0.5 text-xs text-subtle">${opts.meta}</p>` : ""}
  </div>
  ${opts.actions ? `<div class="flex shrink-0 items-center gap-2">${opts.actions}</div>` : ""}
</div>`;
}
