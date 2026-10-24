/**
 * Searches loaded runtime function documentation with adaptive hybrid retrieval, optionally only functions
 * carrying a function tag.
 *
 * Use to find a function by intent (`{ query: "read only sql" }`), to list the functions of one tag
 * (`{ tag: "view" }` — every page that opens by address; no query needed), or both (`{ query: "calendar",
 * tag: "view" }`). `tagValue` narrows a tag with an argument: `{ tag: "canvas", tagValue: "tests" }`. Tags are
 * declared by `$tag_<name>.ts` files (runtime.docs.tags lists them); an unknown tag is an error naming the known
 * ones. Functions of another person's, project's or agent's memory level (`user_*`, `project_*`, `agent_*`) that
 * the caller may not run are left out before the limit.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** User intent or concise search terms. May be empty when `tag` is given: then the tagged functions are listed by name. */
        query?: string;
        /** Maximum compact matches. @default 10 @minimum 1 @maximum 50 */
        limit?: number;
        /** Restrict results to a dotted namespace. */
        namespace?: string;
        /** Only functions carrying this function tag, without the `@`, e.g. `view`, `canvas`, `live`. */
        tag?: string;
        /** With `tag`: only functions whose tag has this argument, e.g. `tests` for `@canvas tests`. */
        tagValue?: string;
        /** Retrieval strategy. `hybrid` uses BM25 fast path then adaptive fusion. */
        mode?: "hybrid" | "bm25" | "vector" | "lexical";
    },
): Promise<Array<{ name: string; summary: string; signature: string; rel: string; score: number; bm25?: number | null; similarity?: number | null; evidence?: string }>> {
    const query = String(opts.query ?? "").trim();
    const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 10)));
    const namespace = String(opts.namespace ?? "").replace(/\.$/, "");
    const mode = opts.mode ?? "hybrid";
    const tag = String(opts.tag ?? "").replace(/^@/, "").trim();
    const tagValue = String(opts.tagValue ?? "").trim();
    // Checked before any retrieval and outside the fallback below: a typo in a tag is the caller's error, not
    // a reason to answer from another branch with everything.
    if (tagValue && !tag) throw new Error("runtime.docs.search: tagValue needs tag");
    if (tag) {
        const known = (await ctx.fns.runtime.docs.tags({})).map(t => t.name);
        if (!known.includes(tag)) throw new Error(`runtime.docs.search: unknown tag "${tag}" — known tags: ${known.join(", ") || "none"}`);
    }
    const filter: Filter = { namespace, tag, tagValue, hidden: session ? await ctx.fns.runtime.docs.hiddenModules({}) : [] };
    if (mode === "lexical") return lexical(ctx, query, limit, filter);
    try {
        const indexed = Number((await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int n FROM functions", params: [] }) as any[])[0]?.n ?? 0);
        if (!indexed) await ctx.fns.runtime.docs.index({});
        if (!query) return await listed(ctx, limit, filter);
        const keyword = await bm25(ctx, query, Math.max(limit, 60), filter);
        if (mode === "bm25") return keyword.slice(0, limit);
        // Exact/prefix function names are authoritative and avoid an unnecessary
        // network round trip. Generic prose never takes this fast path.
        if (mode === "hybrid" && exactNameConfidence(keyword, query)) return keyword.filter(row => exactNameMatch(row.name, query)).slice(0, limit).map(row => ({ ...row, evidence: "exact-name" }));
        const provider = await ctx.fns.embeddings.provider({});
        if (provider === "off") return keyword.slice(0, limit);
        const result = await ctx.fns.embeddings.embed({ input: query });
        const vector = result.vectors[0];
        if (!vector) return keyword.slice(0, limit);
        const semantic = await vectorOnly(ctx, vector, 60, filter);
        if (mode === "vector") return semantic.slice(0, limit);
        const keywords = await kwBm25(ctx, query, 60, filter);
        return adaptiveFuse(keyword, semantic, keywords, limit);
    } catch {
        return lexical(ctx, query, limit, filter);
    }
}

// What every branch restricts by: namespace, tag (+ its argument) and the memory-level modules the caller may
// not run. One builder, so the SQL branches and the in-memory lexical fallback cannot disagree.
type Filter = { namespace: string; tag: string; tagValue: string; hidden: string[] };
function where(filter: Filter): { sql: string; params: any[] } {
    const parts: string[] = [], params: any[] = [];
    if (filter.namespace) { parts.push("(namespace = ? OR namespace LIKE ?)"); params.push(filter.namespace, filter.namespace + ".%"); }
    if (filter.tag && filter.tagValue) { parts.push("tags @> ?::jsonb"); params.push(JSON.stringify({ [filter.tag]: [filter.tagValue] })); }
    else if (filter.tag) { parts.push("jsonb_exists(tags, ?)"); params.push(filter.tag); }
    if (filter.hidden.length) { parts.push(`split_part(name, '.', 1) NOT IN (${filter.hidden.map(() => "?").join(", ")})`); params.push(...filter.hidden); }
    return { sql: parts.map(p => " AND " + p).join(""), params };
}
function passes(meta: any, filter: Filter): boolean {
    if (filter.hidden.includes(String(meta.name).split(".")[0] ?? "")) return false;
    if (!filter.tag) return true;
    const values = meta.tags?.[filter.tag];
    return Array.isArray(values) && (!filter.tagValue || values.includes(filter.tagValue));
}

// No query, only a filter (usually a tag): the matching functions by name.
async function listed(ctx: Context, limit: number, filter: Filter): Promise<any[]> {
    const w = where(filter);
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel FROM functions WHERE true${w.sql} ORDER BY name LIMIT ${limit}`,
        params: w.params,
    });
    return rows.map((row: any) => compact(row, 1, null, null, "filter"));
}

// Keyword retrieval over the short `kw_text` field, ranked separately from the
// prose. BM25 rewards term frequency, so a capability whose generated Russian
// prose happens to repeat a word fourteen times outranks the one that actually
// owns the subject — gmail.list mentions "mail" once, inbox.loop fourteen
// times, and "check mail" therefore returned the encrypted-relay inbox.
// Scoring the deduplicated keyword field as its own branch removes frequency
// from the comparison: every capability states each word exactly once, so the
// question becomes whether the word applies, not how often it was written.
async function kwBm25(ctx: Context, query: string, limit: number, filter: Filter): Promise<any[]> {
    const w = where(filter);
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, paradedb.score(name) AS score
                FROM functions
               WHERE kw_text @@@ paradedb.match('kw_text', ?)${w.sql}
               ORDER BY score DESC, name LIMIT ${limit}`,
        params: [query, ...w.params],
    });
    return rows.map((row: any) => compact(row, Number(row.score), Number(row.score), null, "keywords"));
}

async function bm25(ctx: Context, query: string, limit: number, filter: Filter): Promise<any[]> {
    const w = where(filter);
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, paradedb.score(name) AS score
                FROM functions
               WHERE search_text @@@ paradedb.match('search_text', ?)${w.sql}
               ORDER BY score DESC, name LIMIT ${limit}`,
        params: [query, ...w.params],
    });
    return rows.map((row: any) => compact(row, Number(row.score), Number(row.score), null, "bm25"));
}

async function vectorOnly(ctx: Context, vector: number[], limit: number, filter: Filter): Promise<any[]> {
    const w = where(filter);
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT name, summary, signature, rel, 1-(embedding <=> ?::public.halfvec) AS similarity
                FROM functions WHERE embedding IS NOT NULL${w.sql}
               ORDER BY embedding <=> ?::public.halfvec LIMIT ${limit}`,
        params: [JSON.stringify(vector), ...w.params, JSON.stringify(vector)],
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

function lexical(ctx: Context, query: string, limit: number, filter: Filter): any[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = ctx.fns.runtime.docs.list({ namespace: filter.namespace }).map((item: any) => ctx.fns.runtime.docs.get({ name: item.name })).filter((meta: any) => passes(meta, filter));
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
