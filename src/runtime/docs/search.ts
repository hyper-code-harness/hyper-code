/** Searches loaded runtime function documentation with adaptive hybrid retrieval. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User intent or concise search terms. */
        query: string;
        /** Maximum compact matches. @default 10 @minimum 1 @maximum 50 */
        limit?: number;
        /** Restrict results to a dotted namespace. */
        namespace?: string;
        /** Retrieval strategy. `hybrid` uses BM25 fast path then adaptive fusion. */
        mode?: "hybrid" | "bm25" | "vector" | "lexical";
    },
): Promise<Array<{ name: string; summary: string; signature: string; rel: string; score: number; bm25?: number | null; similarity?: number | null; evidence?: string }>> {
    const query = String(opts.query ?? "").trim();
    const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 10)));
    const namespace = String(opts.namespace ?? "").replace(/\.$/, "");
    const mode = opts.mode ?? "hybrid";
    if (!query || mode === "lexical") return lexical(ctx, query, limit, namespace);
    try {
        const indexed = Number((await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int n FROM functions", params: [] }) as any[])[0]?.n ?? 0);
        if (!indexed) await ctx.fns.runtime.docs.index({});
        const keyword = await bm25(ctx, query, Math.max(limit, 60), namespace);
        if (mode === "bm25") return keyword.slice(0, limit);
        // Exact/prefix function names are authoritative and avoid an unnecessary
        // network round trip. Generic prose never takes this fast path.
        if (mode === "hybrid" && exactNameConfidence(keyword, query)) return keyword.filter(row => exactNameMatch(row.name, query)).slice(0, limit).map(row => ({ ...row, evidence: "exact-name" }));
        const provider = await ctx.fns.embeddings.provider({});
        if (provider === "off") return keyword.slice(0, limit);
        const result = await ctx.fns.embeddings.embed({ input: query });
        const vector = result.vectors[0];
        if (!vector) return keyword.slice(0, limit);
        const semantic = await vectorOnly(ctx, vector, 60, namespace);
        if (mode === "vector") return semantic.slice(0, limit);
        const keywords = await kwBm25(ctx, query, 60, namespace);
        return adaptiveFuse(keyword, semantic, keywords, limit);
    } catch {
        return lexical(ctx, query, limit, namespace);
    }
}

// Keyword retrieval over the short `kw_text` field, ranked separately from the
// prose. BM25 rewards term frequency, so a capability whose generated Russian
// prose happens to repeat a word fourteen times outranks the one that actually
// owns the subject — gmail.list mentions "почта" once, inbox.loop fourteen
// times, and "проверить почту" therefore returned the encrypted-relay inbox.
// Scoring the deduplicated keyword field as its own branch removes frequency
// from the comparison: every capability states each word exactly once, so the
// question becomes whether the word applies, not how often it was written.
async function kwBm25(ctx: Context, query: string, limit: number, namespace: string): Promise<any[]> {
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, paradedb.score(name) AS score
                FROM functions
               WHERE kw_text @@@ paradedb.match('kw_text', ?)${namespace ? " AND (namespace = ? OR namespace LIKE ?)" : ""}
               ORDER BY score DESC, name LIMIT ${limit}`,
        params: namespace ? [query, namespace, namespace + ".%"] : [query],
    });
    return rows.map((row: any) => compact(row, Number(row.score), Number(row.score), null, "keywords"));
}

async function bm25(ctx: Context, query: string, limit: number, namespace: string): Promise<any[]> {
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, paradedb.score(name) AS score
                FROM functions
               WHERE search_text @@@ paradedb.match('search_text', ?)${namespace ? " AND (namespace = ? OR namespace LIKE ?)" : ""}
               ORDER BY score DESC, name LIMIT ${limit}`,
        params: namespace ? [query, namespace, namespace + ".%"] : [query],
    });
    return rows.map((row: any) => compact(row, Number(row.score), Number(row.score), null, "bm25"));
}

async function vectorOnly(ctx: Context, vector: number[], limit: number, namespace: string): Promise<any[]> {
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, 1-(embedding <=> ?::public.halfvec) AS similarity
                FROM functions WHERE embedding IS NOT NULL${namespace ? " AND (namespace = ? OR namespace LIKE ?)" : ""}
               ORDER BY embedding <=> ?::public.halfvec LIMIT ${limit}`,
        params: namespace ? [JSON.stringify(vector), namespace, namespace + ".%", JSON.stringify(vector)] : [JSON.stringify(vector), JSON.stringify(vector)],
    });
    return rows.map((row: any) => compact(row, Number(row.similarity), null, Number(row.similarity), "vector"));
}

function adaptiveFuse(keyword: any[], semantic: any[], keywords: any[], limit: number): any[] {
    const kwRank = new Map(keyword.map((row, index) => [row.name, { rank: index + 1, score: row.bm25, row }]));
    const vecRank = new Map(semantic.map((row, index) => [row.name, { rank: index + 1, score: row.similarity, row }]));
    const kwdRank = new Map(keywords.map((row, index) => [row.name, { rank: index + 1, score: row.bm25, row }]));
    const names = new Set([...kwRank.keys(), ...vecRank.keys(), ...kwdRank.keys()]);
    const candidates: any[] = [];
    // Cosine similarity is not comparable across queries: an English phrase that
    // echoes the indexed prose peaks near 0.6, while a colloquial Russian request
    // against the same capability tops out around 0.3. A fixed floor therefore
    // silences the vector branch for a whole language instead of filtering weak
    // matches, so both gates are relative to the best similarity this query found.
    const topSimilarity = semantic.length ? Math.max(...semantic.map(row => Number(row.similarity) || 0)) : 0;
    const vectorOnlyFloor = Math.max(0.2, topSimilarity * 0.92);
    const intersectionFloor = Math.max(0.12, topSimilarity * 0.6);
    for (const name of names) {
        if (String(name).startsWith("tmp.")) continue;
        const kw: any = kwRank.get(name), vec: any = vecRank.get(name), kwd: any = kwdRank.get(name);
        const bm25 = kw?.score == null ? null : Number(kw.score);
        const similarity = vec?.score == null ? null : Number(vec.score);
        const branches = (kw ? 1 : 0) + (vec ? 1 : 0) + (kwd ? 1 : 0);
        // Independent branch gates. Agreement between any two rankings lowers the
        // per-branch floor, because two retrievers reaching the same capability by
        // different evidence is itself the signal. Single-branch evidence must be
        // substantially stronger to enter the fused set.
        const qualifies = branches >= 2
            ? (bm25 == null || bm25 >= 3) && (similarity == null || similarity >= intersectionFloor)
            : kw ? bm25! >= 12
                : kwd ? Number(kwd.score) >= 8
                    : similarity! >= vectorOnlyFloor;
        if (!qualifies) continue;
        const score = (kw ? 1 / (60 + kw.rank) : 0) + (vec ? 1 / (60 + vec.rank) : 0) + (kwd ? 1 / (60 + kwd.rank) : 0);
        const row = kw?.row ?? vec?.row ?? kwd?.row;
        const evidence = branches >= 2 ? "intersection" : kw ? "bm25-only" : kwd ? "keywords-only" : "vector-only";
        candidates.push(compact(row, score, bm25, similarity, evidence));
    }
    return candidates.sort((a, b) => b.score - a.score || (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity) || a.name.localeCompare(b.name)).slice(0, limit);
}

function exactNameConfidence(keyword: any[], query: string): boolean {
    return keyword.some(row => exactNameMatch(row.name, query));
}

function exactNameMatch(value: string, query: string): boolean {
    const q = query.toLowerCase().trim().replace(/^ctx\.fns\./, "");
    const name = String(value).toLowerCase();
    return name === q || name.endsWith("." + q) || q === name.replaceAll(".", " ");
}

function lexical(ctx: Context, query: string, limit: number, namespace: string): any[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = ctx.fns.runtime.docs.list({ namespace }).map((item: any) => ctx.fns.runtime.docs.get({ name: item.name }));
    return all.map((meta: any) => {
        const name = String(meta.name).toLowerCase();
        const prose = `${meta.summary ?? ""} ${meta.doc ?? ""} ${JSON.stringify(meta.paramsSchema ?? {})}`.toLowerCase();
        let matched = 0;
        const score = words.reduce((sum, word) => {
            if (name === word) { matched++; return sum + 20; }
            if (name.includes(word)) { matched++; return sum + 6; }
            if (prose.includes(word)) { matched++; return sum + 2; }
            return sum;
        }, 0) + (words.length > 1 && words.every(word => name.includes(word) || prose.includes(word)) ? 10 : 0);
        return { meta, score };
    }).filter(hit => !words.length || hit.score > 0).sort((a, b) => b.score - a.score || a.meta.name.localeCompare(b.meta.name)).slice(0, limit)
        .map(({ meta, score }) => compact(meta, score, null, null, "lexical"));
}

function compact(row: any, score: number, bm25: number | null, similarity: number | null, evidence?: string): any {
    return { name: row.name, summary: row.summary, signature: row.signature, rel: row.rel, score, bm25, similarity, evidence };
}
