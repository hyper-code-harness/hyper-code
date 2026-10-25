/**
 * Draws a one-line text input (text, search, number, email, url, password, date, datetime-local, time) with the
 * native validation limits, which a server collector may read back. Carries data-field with its name, so
 * page.fill finds it. Wrap it in w.field for a visible label, help and error.
 * @param opts.name Submitted field name; also the data-field marker.
 * @param opts.type Input type. @default "text"
 * @param opts.value Current value.
 * @param opts.placeholder Hint in the empty field.
 * @param opts.label Accessible name when there is no visible label (aria-label).
 * @param opts.id Element id, for a label's for= or aria-describedby.
 * @param opts.required The field must be filled.
 * @param opts.invalid Marks the value as wrong (aria-invalid); w.field sets it with an error.
 * @param opts.describedBy Id of the element that explains the field or its error.
 * @param opts.min Smallest value (number, date).
 * @param opts.max Largest value (number, date).
 * @param opts.step Step of the value (number, time).
 * @param opts.maxlength Most characters.
 * @param opts.pattern Regular expression the value must match.
 * @param opts.width Width: auto by content, fill the row, or a short label-sized box. @default "fill"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Submitted field name; also the data-field marker. */
    name: string;
    /** Input type. @default "text" */
    type?: "text" | "search" | "number" | "email" | "url" | "password" | "date" | "datetime-local" | "time" | "tel";
    /** Current value. */
    value?: string | number;
    /** Hint in the empty field. */
    placeholder?: string;
    /** Accessible name when there is no visible label (aria-label). */
    label?: string;
    /** Element id, for a label's for= or aria-describedby. */
    id?: string;
    /** The field must be filled. */
    required?: boolean;
    /** Marks the value as wrong (aria-invalid); w.field sets it with an error. */
    invalid?: boolean;
    /** Id of the element that explains the field or its error. */
    describedBy?: string;
    /** Smallest value (number, date). */
    min?: number | string;
    /** Largest value (number, date). */
    max?: number | string;
    /** Step of the value (number, time). */
    step?: number | string;
    /** Most characters. */
    maxlength?: number;
    /** Regular expression the value must match. */
    pattern?: string;
    /** Width: auto by content, fill the row, or a short label-sized box. @default "fill" */
    width?: "auto" | "fill" | "short";
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const a = (n: string, v: unknown) => v === undefined || v === null || v === "" ? "" : ` ${n}="${esc(v)}"`;
    return `<input class="w-input" data-width="${opts.width ?? "fill"}" ${ctx.fns.w.marks({ field: opts.name })} name="${esc(opts.name)}" type="${opts.type ?? "text"}" value="${esc(opts.value ?? "")}"${a("placeholder", opts.placeholder)}${a("aria-label", opts.label)}${a("id", opts.id)}${a("min", opts.min)}${a("max", opts.max)}${a("step", opts.step)}${a("maxlength", opts.maxlength)}${a("pattern", opts.pattern)}${a("aria-describedby", opts.describedBy)}${opts.required ? " required" : ""}${opts.invalid ? ' aria-invalid="true"' : ""}>`;
}
