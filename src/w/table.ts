/**
 * Draws a data table: a header row and plain rows, scrolling sideways when too wide.
 *
 * Use for a list of records shown as columns (a view that returns rows, query results, memory lists). Cells are
 * text, numbers or objects (shown as compact JSON in monospace); a cell `{ html }` is trusted HTML (a link, a
 * w.badge). Columns default to the union of the rows' keys in order of first appearance. No rows → w.empty.
 * @param opts.rows Records, one per row; a value `{ html: string }` is trusted HTML, an object is shown as JSON.
 * @param opts.columns Columns in order; label defaults to key. Omit to take every key the rows have.
 * @param opts.empty Text when there are no rows. @default "No rows"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Records, one per row; a value `{ html: string }` is trusted HTML, an object is shown as JSON. */
    rows: Array<Record<string, unknown>>;
    /** Columns in order; label defaults to key. Omit to take every key the rows have. */
    columns?: Array<{ key: string; label?: string }>;
    /** Text when there are no rows. @default "No rows" */
    empty?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const rows = opts.rows ?? [];
    if (!rows.length) return ctx.fns.w.empty({ title: opts.empty ?? "No rows", icon: "table" });
    const cols = opts.columns ?? [...new Set(rows.flatMap(r => Object.keys(r ?? {})))].map(key => ({ key, label: key }));
    const cell = (v: unknown) => {
        if (v == null) return "<td></td>";
        if (typeof v === "object" && !Array.isArray(v) && typeof (v as { html?: unknown }).html === "string") return `<td>${(v as { html: string }).html}</td>`;
        if (typeof v === "object") return `<td data-mono>${esc(JSON.stringify(v))}</td>`;
        return `<td${typeof v === "number" ? " data-num" : ""}>${esc(v)}</td>`;
    };
    const head = cols.map(c => `<th scope="col">${esc(c.label ?? c.key)}</th>`).join("");
    const body = rows.map(r => `<tr>${cols.map(c => cell(r?.[c.key])).join("")}</tr>`).join("");
    return `<div class="w-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
