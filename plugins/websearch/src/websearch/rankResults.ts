type RankedResult = {
    /** Result title. */
    title: string;
    /** Result URL. */
    url: string;
    /** Snippet text the similarity was computed on. */
    description: string;
    /** Cosine similarity between the query and this result, in -1..1; comparable across results of the same query. */
    similarity: number;
    /** Position in the engine's original ordering, zero-based. */
    engineRank: number;
    /** Position after semantic reordering, zero-based. */
    rank: number;
    /** Extra page excerpts carried over from the search result. */
    extraSnippets: string[];
};

const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        const ai = a[i] as number;
        const bi = b[i] as number;
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    const norm = Math.sqrt(na * nb);
    return norm === 0 ? 0 : dot / norm;
};

/**
 * Reorders web search results by embedding similarity to the query and drops the ones below a similarity threshold.
 *
 * Use between websearch.search and opening pages: the engine ranks by its own signals, so a result that merely shares
 * keywords can outrank the one that actually answers the question, and reading it costs a page load. Each result is
 * embedded from its title, snippet and extra snippets, scored against the query by cosine similarity, and returned
 * with a calibrated `similarity` an agent can threshold on. Off-topic results score far lower than on-topic ones
 * (measured on real pages: ~0.31 for a matching query versus ~0.11 for an unrelated one), so `minSimilarity` around
 * 0.15 removes noise without touching good hits. Requires an embeddings provider; without one it throws rather than
 * pretending to rank.
 *
 * @param opts.query Query the results are scored against.
 * @param opts.results Search results to reorder, normally the `results` array from websearch.search.
 * @param opts.minSimilarity Drop results scoring below this cosine similarity. @default 0 @minimum -1 @maximum 1
 * @param opts.limit Maximum number of results returned after filtering. @default 10 @minimum 1 @maximum 50
 * @param opts.useExtraSnippets Include engine extra snippets in the embedded text for a richer signal. @default true
 * @param opts.model Embeddings model override passed to embeddings.embed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Query the results are scored against. */
        query: string;
        /** Search results to reorder, normally the `results` array from websearch.search. */
        results: Array<{
            title: string;
            url: string;
            description?: string;
            extraSnippets?: string[];
        }>;
        /** Drop results scoring below this cosine similarity. @default 0 @minimum -1 @maximum 1 */
        minSimilarity?: number;
        /** Maximum number of results returned after filtering. @default 10 @minimum 1 @maximum 50 */
        limit?: number;
        /** Include engine extra snippets in the embedded text for a richer signal. @default true */
        useExtraSnippets?: boolean;
        /** Embeddings model override passed to embeddings.embed. */
        model?: string;
    },
): Promise<{
    query: string;
    results: RankedResult[];
    dropped: Array<{ url: string; similarity: number }>;
    minSimilarity: number;
    model: string;
    durationMs: number;
}> {
    const query = String(opts.query ?? '').trim();
    if (!query) throw new Error('websearch.rankResults: query is required');
    const input = Array.isArray(opts.results) ? opts.results : [];
    const minSimilarity = Math.max(-1, Math.min(1, Number(opts.minSimilarity ?? 0)));
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(opts.limit ?? 10))));
    const useExtraSnippets = opts.useExtraSnippets !== false;
    const startedAt = performance.now();

    if (input.length === 0) {
        return { query, results: [], dropped: [], minSimilarity, model: '', durationMs: 0 };
    }

    const provider = await ctx.fns.embeddings.provider({});
    if (!provider || provider === 'off') {
        throw new Error('websearch.rankResults: no embeddings provider configured');
    }

    const texts = input.map((result) => {
        const parts = [result.title, result.description ?? ''];
        if (useExtraSnippets) parts.push(...(result.extraSnippets ?? []));
        return parts.filter((part) => String(part ?? '').trim().length > 0).join('\n').slice(0, 4_000);
    });

    const embedding = await ctx.fns.embeddings.embed({ input: [query, ...texts], model: opts.model });
    const vectors = embedding.vectors;
    const queryVector = vectors[0] as number[];

    const scored = input.map((result, index) => ({
        title: result.title,
        url: result.url,
        description: result.description ?? '',
        similarity: Math.round(cosine(queryVector, vectors[index + 1] as number[]) * 10_000) / 10_000,
        engineRank: index,
        extraSnippets: result.extraSnippets ?? [],
    }));

    const kept = scored
        .filter((result) => result.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity || a.engineRank - b.engineRank)
        .slice(0, limit)
        .map((result, position) => ({ ...result, rank: position }));

    const dropped = scored
        .filter((result) => result.similarity < minSimilarity)
        .map((result) => ({ url: result.url, similarity: result.similarity }));

    return {
        query,
        results: kept,
        dropped,
        minSimilarity,
        model: embedding.model,
        durationMs: Math.round(performance.now() - startedAt),
    };
}
