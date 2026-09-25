// A real table — column headers over rows — for a register you scan by column
// rather than read down. A row is an entity (`data-entity`+`data-id`, `data-status`
// when it has one) and each cell carries its column key as `data-role`, so the
// workspace points at a cell the same way it does in a box of rows. `href` makes
// the whole row a link; a column's `render` is for a cell that is a badge or a
// link rather than text.
/**
 * Perform table for the ui subsystem.
 * @param opts.columns The column definitions.
 * @param opts.rows The rows to process.
 * @param opts.entity The entity value used by the operation.
 * @param opts.rowId The row id value used by the operation.
 * @param opts.rowHref The row href value used by the operation.
 * @param opts.empty The empty value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    columns: Array<{ key: string; label: string; class?: string; render?: (row: any) => string }>;
    rows: any[]; entity?: string; rowId?: string; rowHref?: (row: any) => string;
    empty?: string; class?: string;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const idKey = opts.rowId ?? "id";
    const head = opts.columns.map(c => `<th class="${c.class ?? ""}">${esc(c.label)}</th>`).join("");
    const body = opts.rows.map(row => {
        const href = opts.rowHref?.(row);
        const cells = opts.columns.map(c => `<td class="${c.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: c.key })}>${c.render ? c.render(row) : esc(row[c.key])}</td>`).join("");
        const marks = opts.entity ? ctx.fns.procs.ui.attr({ entity: opts.entity, id: row[idKey], status: row.status }) : "";
        return href
            ? `<tr class="hover:bg-base-200 cursor-pointer" ${marks} hx-get="${esc(href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true">${cells}</tr>`
            : `<tr class="hover:bg-base-200" ${marks}>${cells}</tr>`;
    }).join("");

    // `table-sm` is the density a register needs; the shared component layer's default row height is
    // built for a landing page, not for a hundred patients.
    return `<div class="border-base-300 bg-base-100 overflow-x-auto rounded-md border ${opts.class ?? ""}">
  <table class="table table-sm table-pin-rows">
    <thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="${opts.columns.length}" class="text-subtle">${esc(opts.empty ?? "nothing here")}</td></tr>`}</tbody>
  </table>
</div>`;
}
