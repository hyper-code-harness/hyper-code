/**
 * Searches biomedical papers through official PubMed or Europe PMC APIs.
 *
 * Prefer short English biomedical concepts over a long natural-language question.
 * Join synonyms with `OR` and distinct concepts with `AND`. In PubMed, quote only
 * stable phrases and optionally constrain them to fields, for example:
 * `("cold snare polypectomy"[Title/Abstract] OR CSP[Title/Abstract]) AND (pain OR perforation)`.
 * Quoted phrases improve precision but reduce recall, so begin broadly and add
 * quotes, fields, MeSH terms, publication types, or date filters only when needed.
 *
 * By default, the function retrieves a larger candidate pool, lexically preselects
 * up to 40 papers, and asks Jev System One to score all candidates independently
 * in one request. It returns up to 20 papers ordered by semantic relevance, exposes
 * each probability as `relevanceScore`, and removes scores below 0.3. Pass the user's
 * natural-language question as `rankQuery` when `query` is structured PubMed syntax.
 * Use `rerank: "lexical"` for deterministic local scoring or `"none"` for provider order.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Short biomedical query, preferably in English. Combine synonyms with `OR` and separate concepts with `AND`. PubMed supports exact phrases, fields such as `"cold snare polypectomy"[Title/Abstract]`, MeSH expressions, and publication-type filters. Avoid quoting every term: exact phrases narrow results and can miss alternate wording. */ query: string;
        /** Literature source. @default "pubmed" */ source?: "pubmed" | "europepmc";
        /** Maximum papers returned. @default 20 @minimum 1 @maximum 100 */ limit?: number;
        /** Zero-based offset; supported by PubMed. @default 0 @minimum 0 */ offset?: number;
        /** Europe PMC cursor from a previous result. */ cursor?: string;
        /** Earliest publication year. @minimum 1800 */ yearFrom?: number;
        /** Latest publication year. @minimum 1800 */ yearTo?: number;
        /** Restrict Europe PMC results to open-access papers. @default false */ openAccess?: boolean;
        /** Reranking method: semantic Jev scoring, lexical string matching, or untouched provider order. Boolean values remain supported for compatibility (`true` = lexical, `false` = none). @default "jev" */ rerank?: "lexical" | "jev" | "none" | boolean;
        /** Natural-language intent passed to the reranker; use when `query` contains PubMed operators rather than the user's actual question. Defaults to `query`. */ rankQuery?: string;
        /** Candidate-pool multiplier used before reranking. @default 5 @minimum 2 @maximum 10 */ candidateMultiplier?: number;
        /** Maximum lexically preselected papers sent together to Jev. @default 40 @minimum 5 @maximum 80 */ jevCandidates?: number;
        /** Minimum Jev relevance probability retained; only applies to `rerank: "jev"`. Scores are also returned as `paper.relevanceScore`. @default 0.3 @minimum 0 @maximum 1 */ minRelevance?: number;
    },
): Promise<types.medsearch.SearchResult> {
    let query = String(opts.query || "").trim();
    if (!query) throw new Error("medsearch.search: query is required");
    const source = opts.source ?? "pubmed";
    const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
    const rerank = opts.rerank === false || opts.rerank === "none" ? "none" : opts.rerank === true || opts.rerank === "lexical" ? "lexical" : "jev";
    const rankQuery = String(opts.rankQuery || opts.query).trim();
    const candidateMultiplier = Math.max(2, Math.min(opts.candidateMultiplier ?? 5, 10));
    const candidateLimit = rerank !== "none" ? Math.min(100, limit * candidateMultiplier) : limit;
    if (opts.yearFrom || opts.yearTo) {
        const from = opts.yearFrom ?? 1800, to = opts.yearTo ?? new Date().getUTCFullYear();
        query += source === "pubmed" ? ` AND ${from}:${to}[pdat]` : ` AND FIRST_PDATE:[${from}-01-01 TO ${to}-12-31]`;
    }
    if (source === "europepmc" && opts.openAccess) query += " AND OPEN_ACCESS:Y";
    if (source === "europepmc") {
        const data = await ctx.fns.medsearch.europepmc({ path: "search", params: { query, pageSize: String(candidateLimit), cursorMark: opts.cursor ?? "*", resultType: "core" } });
        const records = data.resultList?.result ?? [];
        let papers = await Promise.all(records.map((record: any) => ctx.fns.medsearch.mapPaper({ record })));
        papers = rerank === "jev"
            ? await ctx.fns.medsearch.jevRank({ query: rankQuery, papers, limit, preselect: opts.jevCandidates, minScore: opts.minRelevance ?? 0.3 })
            : rerank === "lexical" ? await ctx.fns.medsearch.rank({ query: rankQuery, papers, limit }) : papers.slice(0, limit);
        return { source, query: String(opts.query), total: Number(data.hitCount || 0), nextCursor: data.nextCursorMark || null, papers };
    }
    const found = await ctx.fns.medsearch.pubmed({ endpoint: "esearch", params: { term: query, retstart: String(Math.max(0, opts.offset ?? 0)), retmax: String(candidateLimit), sort: "relevance" } });
    const ids: string[] = found.esearchresult?.idlist ?? [];
    if (!ids.length) return { source, query: String(opts.query), total: Number(found.esearchresult?.count || 0), nextCursor: null, papers: [] };
    const details = await ctx.fns.medsearch.europepmc({ path: "search", params: { query: `EXT_ID:(${ids.join(" OR ")}) AND SRC:MED`, pageSize: String(ids.length), resultType: "core" } });
    const mapped = await Promise.all((details.resultList?.result ?? []).map((record: any) => ctx.fns.medsearch.mapPaper({ record })));
    const byId = new Map(mapped.map((p: types.medsearch.Paper) => [p.pmid, { ...p, source: "pubmed" as const }]));
    let papers = ids.map((id) => byId.get(id)).filter((p): p is types.medsearch.Paper => Boolean(p));
    papers = rerank === "jev"
        ? await ctx.fns.medsearch.jevRank({ query: rankQuery, papers, limit, preselect: opts.jevCandidates, minScore: opts.minRelevance ?? 0.3 })
        : rerank === "lexical" ? await ctx.fns.medsearch.rank({ query: rankQuery, papers, limit }) : papers.slice(0, limit);
    return { source, query: String(opts.query), total: Number(found.esearchresult?.count || 0), nextCursor: null, papers };
}
