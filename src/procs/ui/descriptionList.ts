// Key/value facts about one thing — a patient, a resource. Two columns on a
// wide pane, one when narrow. `html` for a value that is a link or a badge.
/**
 * Perform description list for the ui subsystem.
 * @param opts.items The items value used by the operation.
 * @param opts.cols The cols value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {items: Array<{ term: string; detail?: string; html?: string; role?: string }>; cols?: 1 | 2; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const cols = opts.cols === 1 ? "" : " sm:grid-cols-2";
    // The gap is what makes a pair read as a pair: too tight and the label of the
    // next row looks like a second line of this row's value.
    return `<dl class="grid grid-cols-1 gap-x-6 gap-y-4${cols} ${opts.class ?? ""}">
  ${opts.items.map(i => `<div ${ctx.fns.procs.ui.attr({ role: i.role })}>
    <dt class="text-xs text-subtle">${esc(i.term)}</dt>
    <dd class="mt-0.5 text-sm text-base-content">${i.html ?? (esc(i.detail) || "—")}</dd>
  </div>`).join("")}
</dl>`;
}
