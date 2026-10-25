/**
 * Draws a labelled form field: the label (with a required mark and an optional quiet note on its right) over the
 * control, then help or the validation error. The wrapper carries data-field; a failed field also carries
 * data-invalid, and its message is data-role="error" — so every failure on a page is
 * [data-field][data-invalid] [data-role="error"].
 * @param opts.name Field name for the data-field marker (the control's name).
 * @param opts.label Visible label.
 * @param opts.control Trusted HTML of the control (w.input, w.select, a textarea).
 * @param opts.for Id of the control, so a click on the label focuses it.
 * @param opts.note Quiet text on the label row, on the right (a time zone, a unit).
 * @param opts.help One sentence under the control on what to enter.
 * @param opts.error What is wrong with the value; replaces help.
 * @param opts.errorId Id of the error line, for the control's aria-describedby.
 * @param opts.required Shows the required mark.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Field name for the data-field marker (the control's name). */
    name: string;
    /** Visible label. */
    label: string;
    /** Trusted HTML of the control (w.input, w.select, a textarea). */
    control: string;
    /** Id of the control, so a click on the label focuses it. */
    for?: string;
    /** Quiet text on the label row, on the right (a time zone, a unit). */
    note?: string;
    /** One sentence under the control on what to enter. */
    help?: string;
    /** What is wrong with the value; replaces help. */
    error?: string;
    /** Id of the error line, for the control's aria-describedby. */
    errorId?: string;
    /** Shows the required mark. */
    required?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const label = `<div class="w-field-head"><label class="w-field-label"${opts.for ? ` for="${esc(opts.for)}"` : ""}>${esc(opts.label)}${opts.required ? ' <span class="w-field-required" aria-hidden="true">*</span>' : ""}</label>${opts.note ? `<span class="w-field-note">${esc(opts.note)}</span>` : ""}</div>`;
    const below = opts.error
        ? `<p class="w-field-error" role="alert" ${ctx.fns.w.marks({ role: "error" })}${opts.errorId ? ` id="${esc(opts.errorId)}"` : ""}>${esc(opts.error)}</p>`
        : opts.help ? `<p class="w-field-help">${esc(opts.help)}</p>` : "";
    return `<div class="w-field" ${ctx.fns.w.marks({ field: opts.name })}${opts.error ? ' data-invalid="true"' : ""}>${label}${opts.control}${below}</div>`;
}
