// A multi-line input — a note, a comment. `name` submits with a form; `field`
// only marks it for UI/test/client code. Usually they are the same, but a GET
// form must not serialize a huge editor just because it is on screen.
/**
 * Perform textarea for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.field The field value used by the operation.
 * @param opts.value The value to apply.
 * @param opts.placeholder The placeholder value used by the operation.
 * @param opts.rows The rows to process.
 * @param opts.class CSS classes to apply.
 * @param opts.ariaLabel The aria label value used by the operation.
 * @param opts.maxlength The maxlength value used by the operation.
 * @param opts.required Mark the field as required so the browser blocks empty submits. @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {name?: string; field?: string; value?: string; placeholder?: string; rows?: number; class?: string; ariaLabel?: string; maxlength?: number; required?: boolean }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const field = opts.field ?? opts.name;
    return `<textarea ${opts.name ? `name="${esc(opts.name)}" ` : ""}${ctx.fns.procs.ui.attr({ field })}${opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : ""} rows="${opts.rows ?? 3}"${opts.required ? " required" : ""}${opts.maxlength != null ? ` maxlength="${opts.maxlength}"` : ""}
  placeholder="${esc(opts.placeholder ?? "")}"
  class="textarea textarea-sm w-full resize-y ${opts.class ?? ""}">${esc(opts.value ?? "")}</textarea>`;
}
