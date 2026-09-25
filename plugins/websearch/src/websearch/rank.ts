type RankedPassage = {
    /** Verbatim passage copied from the supplied text. */
    text: string;
    /** Fused relevance score; higher is more relevant. */
    score: number;
    /** Character offset of the passage inside the supplied text. */
    offset: number;
    /** Rank in the keyword ordering, or null when the passage did not match any query term. */
    keywordRank: number | null;
    /** Rank in the embedding ordering, or null when vector scoring was not used. */
    vectorRank: number | null;
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
 * Ranks the passages of a text against a query using keyword scoring, embeddings, or both fused by reciprocal rank.
 *
 * Use to pick the parts of a long page worth sending to a model or quoting, instead of truncating at an arbitrary
 * character limit. `keyword` is deterministic and free and should stay the default; `vector` catches paraphrases that
 * share no words with the query but costs one embeddings call per passage batch; `hybrid` fuses both orderings and is
 * the safe choice when the wording of the query is unpredictable. Falls back to keyword mode when no embeddings
 * provider is configured, reporting the effective mode in `mode`.
 *
 * @param opts.text Source text or Markdown whose passages are ranked.
 * @param opts.query Query the passages are ranked against.
 * @param opts.mode Scoring strategy: deterministic keywords, embedding similarity, or reciprocal-rank fusion of both. @default keyword
 * @param opts.limit Maximum number of passages returned, best first. @default 5 @minimum 1 @maximum 50
 * @param opts.maxChars Maximum characters kept per returned passage. @default 400 @minimum 80 @maximum 4000
 * @param opts.maxPassages Maximum passages embedded in vector and hybrid modes, which bounds cost. @default 80 @minimum 1 @maximum 400
 * @param opts.model Embeddings model override passed to embeddings.embed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Source text or Markdown whose passages are ranked. */
        text: string;
        /** Query the passages are ranked against. */
        query: string;
        /** Scoring strategy: deterministic keywords, embedding similarity, or reciprocal-rank fusion of both. @default keyword */
        mode?: 'keyword' | 'vector' | 'hybrid';
        /** Maximum number of passages returned, best first. @default 5 @minimum 1 @maximum 50 */
        limit?: number;
        /** Maximum characters kept per returned passage. @default 400 @minimum 80 @maximum 4000 */
        maxChars?: number;
        /** Maximum passages embedded in vector and hybrid modes, which bounds cost. @default 80 @minimum 1 @maximum 400 */
        maxPassages?: number;
        /** Embeddings model override passed to embeddings.embed. */
        model?: string;
    },
): Promise<{
    query: string;
    mode: 'keyword' | 'vector' | 'hybrid';
    requestedMode: 'keyword' | 'vector' | 'hybrid';
    passages: RankedPassage[];
    scannedPassages: number;
    embeddedPassages: number;
    durationMs: number;
}> {
    const text = String(opts.text ?? '');
    const query = String(opts.query ?? '').trim();
    if (!query) throw new Error('websearch.rank: query is required');
    const requestedMode = opts.mode ?? 'keyword';
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(opts.limit ?? 5))));
    const maxChars = Math.max(80, Math.min(4_000, Math.trunc(Number(opts.maxChars ?? 400))));
    const maxPassages = Math.max(1, Math.min(400, Math.trunc(Number(opts.maxPassages ?? 80))));
    const startedAt = performance.now();

    const chunks: Array<{ body: string; offset: number }> = [];
    let cursor = 0;
    for (const chunk of text.split(/\n\s*\n/)) {
        const offset = text.indexOf(chunk, cursor);
        cursor = offset >= 0 ? offset + chunk.length : cursor;
        const body = chunk.replace(/\s+/g, ' ').trim();
        if (body.length >= 40) chunks.push({ body, offset: offset >= 0 ? offset : 0 });
    }

    let mode = requestedMode;
    if (mode !== 'keyword') {
        const provider = await ctx.fns.embeddings.provider({}).catch(() => 'off');
        if (!provider || provider === 'off') mode = 'keyword';
    }

    const keywordRank = new Map<number, number>();
    if (mode !== 'vector') {
        const scored = await ctx.fns.websearch.highlights({
            text,
            query,
            limit: 50,
            maxChars: 4_000,
            minScore: 0,
        });
        scored.highlights.forEach((highlight, index) => {
            const at = chunks.findIndex((chunk) => chunk.offset === highlight.offset);
            if (at >= 0) keywordRank.set(at, index);
        });
    }

    const vectorRank = new Map<number, number>();
    let embedded = 0;
    if (mode !== 'keyword' && chunks.length > 0) {
        const subset = chunks.slice(0, maxPassages);
        embedded = subset.length;
        const embedding = await ctx.fns.embeddings.embed({
            input: [query, ...subset.map((chunk) => chunk.body)],
            model: opts.model,
        });
        const vectors = embedding.vectors;
        const queryVector = vectors[0] as number[];
        vectors
            .slice(1)
            .map((vector, index) => ({ index, score: cosine(queryVector, vector) }))
            .sort((a, b) => b.score - a.score)
            .forEach((entry, position) => vectorRank.set(entry.index, position));
    }

    const candidates = new Set<number>([...keywordRank.keys(), ...vectorRank.keys()]);
    const K = 60;
    const ranked = [...candidates]
        .map((index) => {
            const kr = keywordRank.get(index);
            const vr = vectorRank.get(index);
            let score = 0;
            if (mode !== 'vector' && kr !== undefined) score += 1 / (K + kr);
            if (mode !== 'keyword' && vr !== undefined) score += 1 / (K + vr);
            return {
                index,
                score,
                keywordRank: kr ?? null,
                vectorRank: vr ?? null,
            };
        })
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((entry) => {
            const chunk = chunks[entry.index] as { body: string; offset: number };
            return {
                text: chunk.body.length > maxChars ? `${chunk.body.slice(0, maxChars).trimEnd()}…` : chunk.body,
                score: Math.round(entry.score * 10_000) / 10_000,
                offset: chunk.offset,
                keywordRank: entry.keywordRank,
                vectorRank: entry.vectorRank,
            };
        });

    return {
        query,
        mode,
        requestedMode,
        passages: ranked,
        scannedPassages: chunks.length,
        embeddedPassages: embedded,
        durationMs: Math.round(performance.now() - startedAt),
    };
}
