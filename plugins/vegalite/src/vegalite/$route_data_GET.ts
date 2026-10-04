// GET /vegalite/data?path=<file> — serves one local data file to a chart.
//
// Static rendering inlines data itself and never calls this route; it exists for
// the browser side (a vega-embed spec, a page, a notebook) and for checking by
// hand what a spec's url actually resolves to. The path is confined to the
// configured data root and the size cap applies, so the endpoint cannot be used
// to read the rest of the disk.
//
//   /vegalite/data?path=docs/sales.csv            the file as-is
//   /vegalite/data?path=docs/sales.csv&rows=1     parsed rows as JSON
//   /vegalite/data?path=docs/sales.csv&rows=1&limit=20
const CONTENT_TYPES: Record<string, string> = {
    csv: "text/csv; charset=utf-8",
    tsv: "text/tab-separated-values; charset=utf-8",
    json: "application/json; charset=utf-8",
    ndjson: "application/x-ndjson; charset=utf-8",
    jsonl: "application/x-ndjson; charset=utf-8",
    txt: "text/plain; charset=utf-8",
};

/** Serves a local data file, or its parsed rows, to a Vega-Lite chart. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const path = url.searchParams.get("path") ?? "";
    if (!path) return new Response("missing ?path=", { status: 400 });

    const wantRows = ["1", "true", "yes"].includes(String(url.searchParams.get("rows") ?? "").toLowerCase());
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    try {
        if (wantRows) {
            const read = await ctx.fns.vegalite.readData({ path, limit });
            return Response.json(read, { headers: { "cache-control": "no-store" } });
        }
        const { abs, rel } = await ctx.fns.vegalite.resolveDataPath({ path });
        const file = Bun.file(abs);
        if (!(await file.exists())) return new Response(`not found: ${rel}`, { status: 404 });
        const maxBytes = (await ctx.fns.settings.getNumber({ module: "vegalite", scopeType: "global", key: "maxDataBytes", fallback: 8388608 })) ?? 8388608;
        if (file.size > maxBytes) return new Response(`too large: ${rel} (${file.size} bytes, max ${maxBytes})`, { status: 413 });
        const ext = rel.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
        return new Response(file, {
            headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream", "cache-control": "no-store" },
        });
    } catch (error: any) {
        // resolveDataPath and readData refuse by throwing with the path named;
        // that message is the useful answer here, and it leaks nothing a caller
        // did not already send.
        return new Response(String(error?.message ?? error), { status: 400 });
    }
}
