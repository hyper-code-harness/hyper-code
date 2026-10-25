/**
 * Draws a segmented control: a few joined options of which one is current (a feed, a period, a view). Each option
 * is a w.Action (usually a link with href); the current one is marked aria-current and drawn selected. No items
 * draw nothing.
 * @param opts.items Options in order: label is shown, value identifies it, action is what choosing it does.
 * @param opts.value Value of the current option.
 * @param opts.name Field name for the data-field automation marker.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Options in order: label is shown, value identifies it, action is what choosing it does. */
    items: Array<{ label: string; value: string; action?: types.w.Action }>;
    /** Value of the current option. */
    value?: string;
    /** Field name for the data-field automation marker. */
    name?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const seg = (it: { label: string; value: string; action?: types.w.Action }) => {
        const on = it.value === opts.value;
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? { action: "select" } });
        const t = tag === "div" ? "button" : tag;
        return `<${t} class="w-seg" ${ctx.fns.w.marks({ role: "segment", id: it.value, status: on ? "active" : "" })}${on ? ' aria-current="true"' : ""}${attrs}>${esc(it.label)}</${t}>`;
    };
    if (!opts.items.length) return "";
    return `<div class="w-segmented" role="group" aria-label="${esc(opts.name ?? "options")}"${opts.name ? ` ${ctx.fns.w.marks({ field: opts.name })}` : ""}>${opts.items.map(seg).join("")}</div>`;
}
