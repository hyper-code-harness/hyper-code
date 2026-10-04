// A query result is usually read by a person, and a person reads a Markdown
// table faster than a JSON array. Numbers are right-aligned and grouped,
// timestamps lose their ISO noise, and the row cap is stated instead of
// silently applied.

/**
 * Runs a query and formats the result as a Markdown table ready to paste into an answer.
 *
 * Use when the result is meant to be read rather than processed: columns are
 * aligned by type, numbers get thousands separators, ISO timestamps are
 * shortened, long text is cut, and a truncated result says how many rows were
 * left out. Returns the rows too, so one call can both show and compute.
 * @param opts.sql Read-only DuckDB SQL statement.
 * @param opts.params Values bound to `?` placeholders.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.maxRows Rows to show before the table is truncated. @default 50 @minimum 1 @maximum 1000
 * @param opts.maxWidth Characters a single cell may take before it is cut. @default 60 @minimum 8 @maximum 400
 * @returns The Markdown table, the rows behind it, and the total row count.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Read-only DuckDB SQL statement. */
    sql: string;
    /** Values bound to `?` placeholders. */
    params?: unknown[];
    /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
    db?: string;
    /** Rows to show before the table is truncated. @default 50 @minimum 1 @maximum 1000 */
    maxRows?: number;
    /** Characters a single cell may take before it is cut. @default 60 @minimum 8 @maximum 400 */
    maxWidth?: number;
}): Promise<{ markdown: string; rows: any[]; rowCount: number; truncated: boolean }> {
    const maxRows = Math.max(1, Math.min(Number(opts.maxRows ?? 50), 1000));
    const maxWidth = Math.max(8, Math.min(Number(opts.maxWidth ?? 60), 400));
    const result = await ctx.fns.duckdb.query({ sql: opts.sql, params: opts.params, db: opts.db, maxRows });
    if (!result.rows.length) return { markdown: "_no rows_", rows: [], rowCount: 0, truncated: false };

    const columns = [...new Set(result.rows.flatMap(row => Object.keys(row as Record<string, unknown>)))];
    const numeric = new Set(columns.filter(column => result.rows.every(row => {
        const value = (row as Record<string, unknown>)[column];
        return value === null || value === undefined || typeof value === "number";
    })));
    const cell = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : String(Number(value.toFixed(4)));
        if (typeof value === "object") return clip(JSON.stringify(value), maxWidth);
        const text = String(value);
        // "2026-01-02T00:00:00.000Z" is a date; the zeroes carry nothing.
        const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?(\.\d+)?Z?$/.exec(text);
        if (iso) return iso[2] === "00:00" && !iso[3] ? iso[1]! : `${iso[1]} ${iso[2]}`;
        return clip(text.replaceAll("|", "\\|").replaceAll("\n", " "), maxWidth);
    };

    const header = `| ${columns.join(" | ")} |`;
    const divider = `| ${columns.map(column => numeric.has(column) ? "---:" : "---").join(" | ")} |`;
    const body = result.rows.map(row => `| ${columns.map(column => cell((row as Record<string, unknown>)[column])).join(" | ")} |`);
    const note = result.truncated ? `\n\n_${result.rowCount.toLocaleString("en-US")} rows, showing ${maxRows}_` : "";
    return { markdown: [header, divider, ...body].join("\n") + note, rows: result.rows, rowCount: result.rowCount, truncated: result.truncated };
}

function clip(text: string, max: number): string {
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
