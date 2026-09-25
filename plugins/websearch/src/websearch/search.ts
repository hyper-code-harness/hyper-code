type SearchEngine = 'brave' | 'google-browser';

type SearchResult = {
    /** Result title as reported by the engine. */
    title: string;
    /** Result URL. */
    url: string;
    /** Snippet with engine highlight markup removed. */
    description: string;
    /** Original snippet including the engine's `<strong>` highlight markup, when it provided any. */
    descriptionHtml: string | null;
    /** Publication or crawl age reported by the engine, when available. */
    publishedAt: string | null;
    /** Language code reported by the engine, when available. */
    language: string | null;
    /** Site or profile label reported by the engine, when available. */
    site: string | null;
    /** Additional page excerpts returned by the engine; often enough to answer without opening the page. */
    extraSnippets: string[];
};

const stripTags = (value: string): string =>
    String(value ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

/**
 * Searches the public web through the configured engine and returns ranked links with every field the engine supplied.
 *
 * Use this for retrieval-only web discovery. It does not open result pages or ask an LLM to summarize them.
 * Snippets are returned twice: `description` with the engine's highlight markup stripped, and `descriptionHtml` as the
 * engine sent it. Engine extras are preserved instead of discarded: `publishedAt` tells an agent whether a page is
 * current, and `extraSnippets` often answers the question without opening the page at all. Fields an engine does not
 * provide are null or empty rather than omitted, so both engines share one shape.
 *
 * @param opts.query Search query sent to the selected engine.
 * @param opts.limit Maximum number of ranked results to return. @default 10 @minimum 1 @maximum 20
 * @param opts.engine Search backend; when omitted, uses the `websearch.defaultEngine` setting. @default google-browser
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Search query sent to the selected engine. */
        query: string;
        /** Maximum number of ranked results to return. @default 10 @minimum 1 @maximum 20 */
        limit?: number;
        /** Search backend; when omitted, uses the `websearch.defaultEngine` setting. @default google-browser */
        engine?: SearchEngine;
    },
): Promise<{ query: string; engine: SearchEngine; results: SearchResult[]; durationMs: number }> {
    const query = String(opts.query ?? '').trim();
    if (!query) throw new Error('websearch.search: query is required');
    const limit = Math.max(1, Math.min(20, Math.trunc(Number(opts.limit ?? 10))));
    const configured = await ctx.fns.settings.getString({
        module: 'websearch',
        scopeType: 'global',
        key: 'defaultEngine',
        fallback: 'google-browser',
    });
    const engine = (opts.engine ?? configured) as SearchEngine;
    if (engine !== 'brave' && engine !== 'google-browser') {
        throw new Error(`websearch.search: unsupported engine ${String(engine)}`);
    }

    const startedAt = performance.now();
    let results: SearchResult[];
    if (engine === 'brave') {
        const response = await ctx.fns.brave.search({ query, count: limit });
        results = response.results.map((item: {
            title: string;
            url: string;
            description: string;
            age?: string | null;
            pageAge?: string | null;
            language?: string | null;
            profile?: string | null;
            extraSnippets?: string[] | null;
        }) => ({
            title: stripTags(item.title),
            url: item.url,
            description: stripTags(item.description),
            descriptionHtml: /<[^>]+>/.test(String(item.description ?? '')) ? item.description : null,
            publishedAt: item.age ?? item.pageAge ?? null,
            language: item.language ?? null,
            site: item.profile ?? null,
            extraSnippets: (item.extraSnippets ?? []).map(stripTags).filter((snippet) => snippet.length > 0),
        }));
    } else {
        const response = await ctx.fns.browser.googleSearch({
            query,
            count: limit,
            session: `websearch-${Date.now()}`,
        });
        results = response.results.map((item: { title: string; url: string; snippet?: string }) => ({
            title: stripTags(item.title),
            url: item.url,
            description: stripTags(item.snippet ?? ''),
            descriptionHtml: null,
            publishedAt: null,
            language: null,
            site: null,
            extraSnippets: [],
        }));
    }

    return {
        query,
        engine,
        results: results.slice(0, limit),
        durationMs: Math.round(performance.now() - startedAt),
    };
}
