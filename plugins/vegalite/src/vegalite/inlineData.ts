/**
 * Replaces every `data: { url }` or `data: { sql }` in a Vega-Lite spec with the rows it points at.
 *
 * Rendering resolves data itself instead of letting Vega's loader do it, so a
 * spec that arrives in a Markdown fence cannot turn a page view into a request
 * from this server: local urls are confined to the data root, and an http(s)
 * url is refused unless `vegalite.allowRemoteData` is on. A `sql` string is run
 * read-only through the duckdb plugin, which is refused unless
 * `vegalite.allowSqlData` is on because DuckDB reads outside the data root.
 * Walks the whole spec, so layers, facets, concats and `lookup` transforms are
 * covered too. Use when compiling a spec by hand; vegalite.render calls it
 * already.
 * @param opts.spec Vega-Lite spec, parsed. Not mutated.
 * @returns The spec with every remote reference replaced by inline rows, and one source entry per reference — a `sql:` prefix marks a query.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Vega-Lite spec, parsed. Not mutated. */
    spec: Record<string, unknown>;
}): Promise<{ spec: Record<string, unknown>; sources: { url: string; rows: number; bytes: number; remote: boolean }[] }> {
    const allowRemote = (await ctx.fns.settings.get({ module: "vegalite", scopeType: "global", key: "allowRemoteData" })) === true;
    const sources: { url: string; rows: number; bytes: number; remote: boolean }[] = [];

    const loadSql = async (sql: string) => {
        const allowSql = (await ctx.fns.settings.get({ module: "vegalite", scopeType: "global", key: "allowSqlData" })) === true;
        if (!allowSql) throw new Error("vegalite: data.sql is disabled, refusing to run a query (enable vegalite.allowSqlData to allow it)");
        if (!(ctx.fns as any).duckdb) throw new Error("vegalite: data.sql needs the duckdb plugin, which is not mounted");
        const result = await ctx.fns.duckdb.query({ sql, maxRows: 50_000 });
        return { rows: result.rows, bytes: sql.length };
    };

    const loadRemote = async (url: string, formatType?: string) => {
        if (!allowRemote) throw new Error(`vegalite: remote data is disabled, refusing to fetch ${url} (enable vegalite.allowRemoteData to allow it)`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`vegalite: data url ${url} returned ${res.status}`);
        const text = await res.text();
        const type = formatType ?? (/\.csv($|\?)/i.test(url) ? "csv" : /\.tsv($|\?)/i.test(url) ? "tsv" : /\.(ndjson|jsonl)($|\?)/i.test(url) ? "ndjson" : "json");
        if (type === "ndjson") return { rows: text.split("\n").filter(l => l.trim()).map(l => JSON.parse(l)), bytes: text.length };
        if (type === "json") { const parsed = JSON.parse(text); return { rows: Array.isArray(parsed) ? parsed : [parsed], bytes: text.length }; }
        const vega = await import("vega");
        return { rows: (vega as any).read(text, { type, parse: "auto" }), bytes: text.length };
    };

    const walk = async (node: unknown): Promise<unknown> => {
        if (Array.isArray(node)) return await Promise.all(node.map(walk));
        if (!node || typeof node !== "object") return node;
        const record = node as Record<string, unknown>;

        if (typeof record.sql === "string" && typeof record.url !== "string") {
            const sql = record.sql;
            const loaded = await loadSql(sql);
            sources.push({ url: `sql:${sql.replace(/\s+/g, " ").trim()}`, rows: loaded.rows.length, bytes: loaded.bytes, remote: false });
            const { sql: _sql, format: _sqlFormat, ...rest } = record;
            return { ...rest, values: loaded.rows };
        }

        if (typeof record.url === "string") {
            const url = record.url;
            const format = record.format as { type?: unknown; parse?: unknown } | undefined;
            const formatType = typeof format?.type === "string" ? String(format.type) : undefined;
            const formatParse = format?.parse as Record<string, string> | "auto" | undefined;
            const remote = /^[a-z][a-z0-9+.-]*:/i.test(url);
            const loaded = remote
                ? await loadRemote(url, formatType)
                : await (async () => {
                    const read = await ctx.fns.vegalite.readData({ path: url, format: formatType as any, parse: formatParse });
                    return { rows: read.rows, bytes: read.bytes };
                })();
            sources.push({ url, rows: loaded.rows.length, bytes: loaded.bytes, remote });
            // `url`/`format` go away together: the rows are already parsed, and a
            // leftover format would make Vega re-parse an array.
            const { url: _url, format: _format, ...rest } = record;
            return { ...rest, values: loaded.rows };
        }

        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) out[key] = await walk(value);
        return out;
    };

    return { spec: (await walk(opts.spec)) as Record<string, unknown>, sources };
}
