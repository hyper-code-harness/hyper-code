// DuckDB's JS values are richer than JSON: counts come back as BigInt, dates as
// Date, blobs as Buffer. Everything that leaves the plugin goes through here so
// a result can be JSON.stringify'd, stored in a message, or handed to Vega-Lite
// without a "cannot serialize BigInt" surprise.

/**
 * Converts DuckDB result values into JSON-safe JavaScript.
 *
 * BigInt becomes a number when it fits exactly and a string when it would lose
 * precision, Date becomes an ISO-8601 string that Vega-Lite reads as temporal,
 * binary becomes base64, and lists, structs and maps are converted recursively.
 * Use when handling raw rows from the native connection; `duckdb.run` and
 * everything above it already returns normalized values.
 * @param opts.value Any value from a DuckDB result row.
 * @returns The same shape with JSON-compatible leaves.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Any value from a DuckDB result row. */
    value: unknown;
}): unknown {
    return convert(opts.value);
}

function convert(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === "bigint") {
        // Number() silently rounds past 2^53; a count never gets there, an id
        // might, and a wrong number is worse than a string.
        return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    if (typeof value !== "object") return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
    if (Array.isArray(value)) return value.map(convert);
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = convert(inner);
    return out;
}
