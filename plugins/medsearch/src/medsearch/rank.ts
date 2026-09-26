const STOP = new Set([
    "and", "or", "not", "the", "with", "after", "before", "from", "into", "about",
    "article", "title", "abstract", "mesh", "publication", "type", "events", "adverse",
]);

function normalized(value: string): string {
    return value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Reranks a candidate set by lexical agreement with the original biomedical query. Exact phrases and title matches receive the highest weight; short ambiguous acronyms are ignored unless quoted. */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Original PubMed-style query used to score candidates. */ query: string;
        /** Candidate papers to reorder without removing records. */ papers: types.medsearch.Paper[];
        /** Maximum papers returned after ranking. @minimum 1 @maximum 100 */ limit: number;
    },
): Promise<types.medsearch.Paper[]> {
    const query = String(opts.query || "");
    const phrases = [...query.matchAll(/"([^"\n]+)"/g)].map((match) => normalized(match[1] || "")).filter(Boolean);
    const stripped = query.replace(/"[^"\n]+"/g, " ").replace(/\[[^\]]+\]/g, " ");
    const terms = [...new Set(normalized(stripped).split(" ").filter((term) => term.length >= 4 && !STOP.has(term) && !/^\d+$/.test(term)))];
    const phraseTerms = [...new Set(phrases.flatMap((phrase) => phrase.split(" ")).filter((term) => term.length >= 4 && !STOP.has(term)))];
    const concepts = [...new Set([...terms, ...phraseTerms])];

    const scored = opts.papers.map((paper, index) => {
        const title = normalized(paper.title);
        const abstract = normalized(paper.abstract);
        const metadata = normalized(`${paper.meshTerms.join(" ")} ${paper.publicationTypes.join(" ")}`);
        let score = 0;
        for (const phrase of phrases) {
            if (title.includes(phrase)) score += 18;
            else if (abstract.includes(phrase)) score += 7;
        }
        let covered = 0;
        for (const term of concepts) {
            const inTitle = title.includes(term), inAbstract = abstract.includes(term), inMetadata = metadata.includes(term);
            if (inTitle || inAbstract || inMetadata) covered++;
            if (inTitle) score += 4;
            else if (inMetadata) score += 2;
            else if (inAbstract) score += 1;
        }
        score += concepts.length ? 8 * covered / concepts.length : 0;
        return { paper, score, index };
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.slice(0, Math.max(1, Math.min(opts.limit, 100))).map((item) => item.paper);
}
