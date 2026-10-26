/**
 * Draws an on/off switch: a checkbox drawn as a small track with a thumb (ink when on), with a label and one quiet
 * hint line. The state is the checkbox itself, so a form with hx-trigger="change" saves it without any script.
 * @param opts.name Submitted field name; also the data-field marker. Checked sends value 1, unchecked sends nothing.
 * @param opts.on Starts switched on. @default false
 * @param opts.label Visible label; also the accessible name.
 * @param opts.hint One quiet line under the label on what it does.
 * @param opts.title Tooltip, e.g. why it has no effect right now.
 * @param opts.disabled Shown but not changeable.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Submitted field name; also the data-field marker. Checked sends value 1, unchecked sends nothing. */
    name: string;
    /** Starts switched on. @default false */
    on?: boolean;
    /** Visible label; also the accessible name. */
    label: string;
    /** One quiet line under the label on what it does. */
    hint?: string;
    /** Tooltip, e.g. why it has no effect right now. */
    title?: string;
    /** Shown but not changeable. */
    disabled?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const text = `<span class="w-switch-text"><span>${esc(opts.label)}</span>${opts.hint ? `<span class="w-switch-hint">${esc(opts.hint)}</span>` : ""}</span>`;
    return `<label class="w-switch"${opts.title ? ` title="${esc(opts.title)}"` : ""}>${text}<input type="checkbox" role="switch" ${ctx.fns.w.marks({ field: opts.name })} name="${esc(opts.name)}" value="1"${opts.on ? " checked" : ""}${opts.disabled ? " disabled" : ""}><span class="w-switch-track" aria-hidden="true"></span></label>`;
}
