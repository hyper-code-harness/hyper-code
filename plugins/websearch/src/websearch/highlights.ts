type Highlight = {
    /** Verbatim passage copied from the supplied text. */
    text: string;
    /** Relevance score; higher means more query terms matched, density-weighted. */
    score: number;
    /** Character offset of the passage inside the supplied text. */
    offset: number;
};

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or',
    'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'does', 'do',
]);

/**
 * Extracts the passages of a text that best match a query, without calling an LLM.
 *
 * Use to attach verbatim evidence to a search result or fetched page so an agent can quote a source
 * instead of trusting a summary. Scoring is deterministic: passages are split on blank lines, scored by
 * how many distinct query terms they contain and by term density, and returned verbatim with offsets.
 * Prefer this over asking a model to "find the relevant part" when the text is already available.
 *
 * @param opts.text Source text or Markdown to scan for matching passages.
 * @param opts.query Query whose terms define relevance.
 * @param opts.limit Maximum number of passages returned, best first. @default 5 @minimum 1 @maximum 20
 * @param opts.maxChars Maximum characters kept per returned passage. @default 400 @minimum 80 @maximum 2000
 * @param opts.minScore Minimum score a passage must reach to be returned. @default 1 @minimum 0
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Source text or Markdown to scan for matching passages. */
        text: string;
        /** Query whose terms define relevance. */
        query: string;
        /** Maximum number of passages returned, best first. @default 5 @minimum 1 @maximum 20 */
        limit?: number;
        /** Maximum characters kept per returned passage. @default 400 @minimum 80 @maximum 2000 */
        maxChars?: number;
        /** Minimum score a passage must reach to be returned. @default 1 @minimum 0 */
        minScore?: number;
    },
): Promise<{ query: string; terms: string[]; highlights: Highlight[]; scannedPassages: number }> {
    const text = String(opts.text ?? '');
    const query = String(opts.query ?? '').trim();
    if (!query) throw new Error('websearch.highlights: query is required');
    const limit = Math.max(1, Math.min(20, Math.trunc(Number(opts.limit ?? 5))));
    const maxChars = Math.max(80, Math.min(2_000, Math.trunc(Number(opts.maxChars ?? 400))));
    const minScore = Math.max(0, Number(opts.minScore ?? 1));

    const terms = Array.from(
        new Set(
            query
                .toLowerCase()
                .split(/[^\p{L}\p{N}]+/u)
                .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
        ),
    );
    if (terms.length === 0) return { query, terms, highlights: [], scannedPassages: 0 };

    const passages: Array<{ body: string; offset: number }> = [];
    let cursor = 0;
    for (const chunk of text.split(/\n\s*\n/)) {
        const offset = text.indexOf(chunk, cursor);
        cursor = offset >= 0 ? offset + chunk.length : cursor;
        const body = chunk.replace(/\s+/g, ' ').trim();
        if (body.length >= 40) passages.push({ body, offset: offset >= 0 ? offset : 0 });
    }

    const scored: Highlight[] = [];
    for (const passage of passages) {
        const lower = passage.body.toLowerCase();
        let distinct = 0;
        let hits = 0;
        for (const term of terms) {
            const count = lower.split(term).length - 1;
            if (count > 0) {
                distinct += 1;
                hits += count;
            }
        }
        if (distinct === 0) continue;
        const density = hits / Math.max(1, passage.body.length / 400);
        const score = Math.round((distinct + Math.min(distinct, density)) * 100) / 100;
        if (score < minScore) continue;
        scored.push({
            text: passage.body.length > maxChars ? `${passage.body.slice(0, maxChars).trimEnd()}…` : passage.body,
            score,
            offset: passage.offset,
        });
    }

    scored.sort((a, b) => b.score - a.score || a.offset - b.offset);
    return { query, terms, highlights: scored.slice(0, limit), scannedPassages: passages.length };
}
