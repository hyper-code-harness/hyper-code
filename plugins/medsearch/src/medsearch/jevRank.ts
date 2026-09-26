/**
 * Semantically reranks biomedical papers with one Jev System One fan-out request.
 *
 * First performs cheap lexical preselection, then places one independent relevance
 * question per paper into a single `jev.decide` call. Returned `noul` probabilities
 * become `paper.relevanceScore`; papers below `minScore` are removed. If Jev fails,
 * the function safely returns the lexical order without fabricated scores. Use this
 * for clinically focused or natural-language questions where keyword overlap alone
 * cannot distinguish the intervention, population, complication, and outcome.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Natural-language clinical or research intent used to judge relevance. */ query: string;
        /** Candidate papers retrieved from PubMed or Europe PMC. */ papers: types.medsearch.Paper[];
        /** Maximum papers returned. @minimum 1 @maximum 100 */ limit: number;
        /** Maximum lexically preselected candidates scored by Jev in one request. @default 40 @minimum 5 @maximum 80 */ preselect?: number;
        /** Minimum Jev relevance probability retained. @default 0 */ minScore?: number;
        /** Jev request timeout in milliseconds. @default 8000 @minimum 500 @maximum 30000 */ timeoutMs?: number;
    },
): Promise<types.medsearch.Paper[]> {
    const limit = Math.max(1, Math.min(opts.limit, 100));
    const preselect = Math.max(5, Math.min(opts.preselect ?? 40, 80));
    const lexical = await ctx.fns.medsearch.rank({ query: opts.query, papers: opts.papers, limit: Math.min(preselect, opts.papers.length) });
    if (!lexical.length) return [];

    const questions: Record<string, types.jev.Question> = {};
    lexical.forEach((paper, index) => {
        questions[`p${index}`] = {
            type: "noul",
            instructions: {
                task: "Is this biomedical paper directly relevant to the clinical or research question? Prefer matching intervention, population, complication and outcome; reject coincidental keyword matches.",
                candidate: [
                    `Title: ${paper.title}`,
                    `Abstract: ${paper.abstract.slice(0, 4000)}`,
                    paper.publicationTypes.length ? `Publication types: ${paper.publicationTypes.join(", ")}` : "",
                    paper.meshTerms.length ? `MeSH: ${paper.meshTerms.join(", ")}` : "",
                ].filter(Boolean).join("\n"),
            },
            criteria: {
                true: "Directly helps answer the question or assess the specified clinical scenario",
                false: "Unrelated, only superficially similar, or about a materially different intervention or outcome",
            },
        };
    });

    try {
        const out = await ctx.fns.jev.decide({
            state: opts.query,
            questions,
            timeoutMs: Math.max(500, Math.min(opts.timeoutMs ?? 8000, 30000)),
        });
        const minScore = Math.max(0, Math.min(opts.minScore ?? 0, 1));
        return lexical.map((paper, index) => {
            const answer = out.answers[`p${index}`];
            const score = answer && answer.type === "noul" ? answer.noul : 0;
            return { paper, score, index };
        }).filter((item) => item.score >= minScore)
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .slice(0, limit)
            .map((item) => ({ ...item.paper, relevanceScore: item.score }));
    } catch {
        return lexical.slice(0, limit);
    }
}
