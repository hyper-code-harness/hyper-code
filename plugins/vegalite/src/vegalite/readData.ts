/**
 * Reads a local data file for a chart and parses it into an array of rows.
 *
 * Accepts CSV, TSV, JSON and NDJSON, inferring the format from the extension
 * unless `format` says otherwise, and parses numbers and dates the way
 * Vega-Lite would. Use to feed a spec from a file on disk, or to preview what a
 * `data: { url }` will actually see. The path is confined to the configured
 * data root and the file size is capped by `vegalite.maxDataBytes`.
 * @param opts.path Data file path, relative to the data root or absolute inside it.
 * @param opts.format Parser to use instead of the one inferred from the extension.
 * @param opts.parse Per-field types for CSV/TSV, as in a Vega-Lite `format.parse`; `"string"` keeps a column like `2026-01` from becoming a date.
 * @param opts.limit Keep only the first N rows; omitted means all of them. @minimum 1
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Data file path, relative to the data root or absolute inside it. */
    path: string;
    /** Parser to use instead of the one inferred from the extension. */
    format?: "csv" | "tsv" | "json" | "ndjson";
    /** Per-field types for CSV/TSV, as in a Vega-Lite `format.parse`; `"string"` keeps a column like `2026-01` from becoming a date. */
    parse?: Record<string, string> | "auto";
    /** Keep only the first N rows; omitted means all of them. @minimum 1 */
    limit?: number;
}): Promise<{ rel: string; format: string; bytes: number; rows: Record<string, unknown>[]; truncated: boolean }> {
    const { abs, rel } = await ctx.fns.vegalite.resolveDataPath({ path: opts.path });
    const file = Bun.file(abs);
    if (!(await file.exists())) throw new Error(`vegalite: data file not found: ${rel}`);

    const maxBytes = (await ctx.fns.settings.getNumber({ module: "vegalite", scopeType: "global", key: "maxDataBytes", fallback: 8388608 })) ?? 8388608;
    const bytes = file.size;
    if (bytes > maxBytes) throw new Error(`vegalite: data file too large: ${rel} (${bytes} bytes, max ${maxBytes})`);

    const ext = rel.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    const format = opts.format ?? (ext === "csv" ? "csv" : ext === "tsv" ? "tsv" : ext === "ndjson" || ext === "jsonl" ? "ndjson" : "json");
    const text = await file.text();

    let rows: Record<string, unknown>[];
    if (format === "ndjson") {
        rows = text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
    } else if (format === "json") {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : [parsed];
    } else {
        // vega's own reader, so a chart fed from here sees exactly the values
        // the same file would produce through a spec url.
        const vega = await import("vega");
        // "auto" guesses per column, which reads `2026-01` as a date; a spec that
        // wants the literal text says so through format.parse.
        rows = (vega as any).read(text, { type: format, parse: opts.parse ?? "auto" });
    }

    const truncated = typeof opts.limit === "number" && opts.limit > 0 && rows.length > opts.limit;
    if (truncated) rows = rows.slice(0, opts.limit);
    return { rel, format, bytes, rows, truncated };
}
