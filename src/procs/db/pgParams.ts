// Bind-value normalisation shared by db.select and db.run.
//
// Bun's postgres driver (1.3.x) sends a JavaScript array passed to `sql.unsafe`
// as a comma-joined string, so `WHERE id = ANY($1::text[])` fails with
// `malformed array literal: "a,b"`. Every call site in this codebase writes
// `?::text[]` / `?::int[]` and passes a real array, so the fix belongs here:
// an array parameter is encoded as a Postgres array literal, which the cast in
// the SQL text parses back into the right element type.
/**
 * Encodes bind values so JavaScript arrays reach Postgres as array literals
 *
 * Use for every parameter list handed to the Bun driver: an array value becomes `{"a","b"}`
 * (NULL elements stay unquoted, quotes and backslashes are escaped), anything else is passed
 * through untouched — numbers, strings, Buffers, Date and JSON strings keep their current binding.
 * @param opts.params Bind values in placeholder order; a non-array value is treated as a single parameter.
 */
export default function (_ctx: Context, _session: Session | null, opts: { params?: any }): any[] {
    const list = opts.params == null ? [] : Array.isArray(opts.params) ? opts.params : [opts.params];
    const element = (value: any): string => {
        if (value == null) return "NULL";
        const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
        return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    };
    return list.map((value) => (Array.isArray(value) ? "{" + value.map(element).join(",") + "}" : value));
}
