/**
 * Draws a colour field: a swatch with the native picker and the hex value — for theme palettes.
 * @param opts.name Form field name.
 * @param opts.value Current colour, #rrggbb.
 * @param opts.label Visible label.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Form field name. */
    name: string;
    /** Current colour, #rrggbb. */
    value: string;
    /** Visible label. */
    label?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const v = /^#[0-9a-f]{6}$/i.test(opts.value) ? opts.value : "#000000";
    return `<label class="w-color"><input type="color" name="${esc(opts.name)}" value="${v}" oninput="this.nextElementSibling.textContent=this.value"><code>${v}</code>${opts.label ? `<span>${esc(opts.label)}</span>` : ""}</label>`;
}
