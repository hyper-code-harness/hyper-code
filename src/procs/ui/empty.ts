// Nothing here yet — but say what would go here and how to make the first one.
// An icon, a line, and an optional action, centred in the space a list would
// have filled. `data-role="empty"` so the workspace can tell empty from loading.
/**
 * Perform empty for the ui subsystem.
 * @param opts.icon The icon value used by the operation.
 * @param opts.title The display title.
 * @param opts.text The text to process.
 * @param opts.action The action URL.
 */
export default function (ctx: Context, _session: Session | null, opts: {icon?: string; title: string; text?: string; action?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<div class="flex flex-col items-center justify-center rounded-md border border-dashed border-base-300 px-6 py-12 text-center" ${ctx.fns.procs.ui.attr({ role: "empty" })}>
  <i class="ph ${esc(opts.icon ?? "ph-tray")} text-2xl text-faint" aria-hidden="true"></i>
  <p class="mt-2 text-sm font-medium text-base-content">${esc(opts.title)}</p>
  ${opts.text ? `<p class="mt-1 max-w-sm text-xs text-subtle">${esc(opts.text)}</p>` : ""}
  ${opts.action ? `<div class="mt-4">${opts.action}</div>` : ""}
</div>`;
}
