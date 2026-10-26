/**
 * Draws a multi-line text box in the w look, carrying the data-field marker. Use it inside w.field for any
 * free-text form input longer than one line (a description, a comment); the box grows with its content.
 * @param opts.name Form field name, also the data-field marker.
 * @param opts.value Initial text (escaped).
 * @param opts.placeholder Hint shown while empty.
 * @param opts.label Accessible name when no visible w.field label points at it.
 * @param opts.id Element id, for w.field's `for`.
 * @param opts.rows Visible rows before it grows.
 * @param opts.required Marks the field required.
 * @param opts.maxlength Maximum number of characters.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Form field name, also the data-field marker. */
    name: string;
    /** Initial text (escaped). */
    value?: string;
    /** Hint shown while empty. */
    placeholder?: string;
    /** Accessible name when no visible w.field label points at it. */
    label?: string;
    /** Element id, for w.field's `for`. */
    id?: string;
    /** Visible rows before it grows. @default 3 @minimum 1 @maximum 40 */
    rows?: number;
    /** Marks the field required. @default false */
    required?: boolean;
    /** Maximum number of characters. @minimum 1 */
    maxlength?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const a = (n: string, v: unknown) => v === undefined || v === null || v === "" ? "" : ` ${n}="${esc(v)}"`;
    const rows = Math.max(1, Math.min(40, Math.round(opts.rows ?? 3)));
    return `<textarea class="w-textarea" ${ctx.fns.w.marks({ field: opts.name })} name="${esc(opts.name)}" rows="${rows}"${a("placeholder", opts.placeholder)}${a("aria-label", opts.label)}${a("id", opts.id)}${a("maxlength", opts.maxlength)}${opts.required ? " required" : ""}>${esc(opts.value ?? "")}</textarea>`;
}
