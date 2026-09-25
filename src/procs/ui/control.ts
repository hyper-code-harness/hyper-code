// A labelled field, Tailwind-UI style: the label (with a required mark) over the
// control, then help or the validation error — with the breathing room a form
// needs to read as one thing, not a stack of jammed rows.
//
// Validation-error convention (so the workspace and the agent can find failures
// after a submit): the field wrapper carries `data-field` and, when it failed,
// `data-invalid="true"` (plus `aria-invalid` for the screen reader); the message
// itself is `data-role="error"` inside it. So every failure is
// `[data-field][data-invalid] [data-role="error"]`, and counting the invalid
// fields is one selector.
/**
 * Perform control for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.label The display label.
 * @param opts.help The help value used by the operation.
 * @param opts.error The error to report.
 * @param opts.required The required value used by the operation.
 * @param opts.control The control value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {name: string; label: string; help?: string; error?: string; required?: boolean; control: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<div ${ctx.fns.procs.ui.attr({ field: opts.name })}${opts.error ? ` data-invalid="true" aria-invalid="true"` : ""}>
  <label class="block text-sm font-medium text-base-content">${esc(opts.label)}${opts.required ? ` <span class="text-error">*</span>` : ""}</label>
  <div class="mt-2">${opts.control}</div>
  ${opts.help && !opts.error ? `<p class="mt-2 text-xs text-subtle">${esc(opts.help)}</p>` : ""}
  ${opts.error ? `<p class="mt-2 text-xs text-error" ${ctx.fns.procs.ui.attr({ role: "error" })}>${esc(opts.error)}</p>` : ""}
</div>`;
}
