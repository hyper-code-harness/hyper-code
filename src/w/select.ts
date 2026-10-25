/**
 * Draws a native select of a few options, the current one selected. Carries data-field with its name, so
 * page.fill finds it. Wrap it in w.field for a visible label.
 * @param opts.name Submitted field name; also the data-field marker.
 * @param opts.options Options: a string is both value and label.
 * @param opts.value Value of the selected option.
 * @param opts.label Accessible name when there is no visible label (aria-label).
 * @param opts.id Element id, for a label's for=.
 * @param opts.width Width: auto by content, or fill the row. @default "auto"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Submitted field name; also the data-field marker. */
    name: string;
    /** Options: a string is both value and label. */
    options: Array<string | { value: string; label: string }>;
    /** Value of the selected option. */
    value?: string;
    /** Accessible name when there is no visible label (aria-label). */
    label?: string;
    /** Element id, for a label's for=. */
    id?: string;
    /** Width: auto by content, or fill the row. @default "auto" */
    width?: "auto" | "fill";
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const options = opts.options.map(o => typeof o === "string" ? { value: o, label: o } : o)
        .map(o => `<option value="${esc(o.value)}"${o.value === opts.value ? " selected" : ""}>${esc(o.label)}</option>`).join("");
    return `<select class="w-select" data-width="${opts.width ?? "auto"}" ${ctx.fns.w.marks({ field: opts.name })} name="${esc(opts.name)}"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}${opts.id ? ` id="${esc(opts.id)}"` : ""}>${options}</select>`;
}
