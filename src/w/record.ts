/**
 * Draws one record of a table-like list: cells in a row, each a named part (data-role) of an entity that carries
 * data-entity, data-id and data-status, so the agent can read values out of it; controls at the end. Records
 * placed one after another are ruled between. With an action the whole row is clickable.
 * @param opts.entity Entity type for the data-entity marker, e.g. "llm-account".
 * @param opts.id Entity id for the data-id marker.
 * @param opts.status Entity state for the data-status marker (ready, limit, error).
 * @param opts.cells Cells in order: role names the part; text is escaped, html is trusted; mix styles the cell; grow takes the free width; width label (7rem) or name (10rem) makes a fixed column; tone colours the text by meaning; wide hides the cell on narrow screens; title is the hover text of a cell that truncates.
 * @param opts.end Trusted HTML of the controls at the end of the row.
 * @param opts.action What happens on click of the whole row.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Entity type for the data-entity marker, e.g. "llm-account". */
    entity: string;
    /** Entity id for the data-id marker. */
    id: string;
    /** Entity state for the data-status marker (ready, limit, error). */
    status?: string;
    /** Cells in order: role names the part; text is escaped, html is trusted; mix styles the cell; grow takes the free width; width label (7rem) or name (10rem) makes a fixed column; tone colours the text by meaning; wide hides the cell on narrow screens; title is the hover text of a cell that truncates. */
    cells: Array<{ role: string; text?: string | number; html?: string; mix?: types.w.Mixin; grow?: boolean; width?: "label" | "name"; tone?: "info" | "success" | "warning" | "danger"; wide?: boolean; title?: string }>;
    /** Trusted HTML of the controls at the end of the row. */
    end?: string;
    /** What happens on click of the whole row. */
    action?: types.w.Action;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const cells = opts.cells.map(c => {
        const cls = ctx.fns.w.mix({ mixes: [c.mix], class: "w-record-cell" });
        return `<span class="${cls}"${c.grow ? " data-grow" : ""}${c.width ? ` data-width="${c.width}"` : ""}${c.tone ? ` data-tone="${c.tone}"` : ""}${c.wide ? " data-wide" : ""}${c.title ? ` title="${esc(c.title)}"` : ""} ${ctx.fns.w.marks({ role: c.role })}>${c.html ?? esc(c.text ?? "")}</span>`;
    }).join("");
    const end = opts.end ? `<span class="w-record-end">${opts.end}</span>` : "";
    const marks = ctx.fns.w.marks({ entity: opts.entity, id: opts.id, status: opts.status });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    return `<${tag} class="w-record" ${marks}${attrs}>${cells}${end}</${tag}>`;
}
