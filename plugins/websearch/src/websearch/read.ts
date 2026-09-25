/**
 * Opens one public URL in the user's browser and returns its readable content as Markdown, without calling an LLM.
 *
 * Use whenever a page's text is needed as data: this is the shared page-reading primitive behind websearch.fetch and
 * websearch.answer. Unlike a single fixed-delay snapshot, it re-snapshots until the extracted length stops growing, so
 * client-rendered pages are not captured half-empty, and it always closes the tab it opened. Prefer websearch.fetch when
 * an LLM instruction should be applied to the page, and websearch.answer when the question spans several pages.
 *
 * @param opts.url Public HTTP or HTTPS page to open and read.
 * @param opts.maxChars Maximum characters of readable Markdown returned. @default 30000 @minimum 1000 @maximum 50000
 * @param opts.settleMs Delay after navigation before the first snapshot. @default 600 @minimum 0 @maximum 10000
 * @param opts.stabilizeMs Pause between re-snapshots while content is still growing. @default 700 @minimum 0 @maximum 5000
 * @param opts.maxAttempts Maximum snapshots taken while waiting for content to stabilize. @default 4 @minimum 1 @maximum 10
 * @param opts.readable Prefer article/main content over the full page body. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Public HTTP or HTTPS page to open and read. */
        url: string;
        /** Maximum characters of readable Markdown returned. @default 30000 @minimum 1000 @maximum 50000 */
        maxChars?: number;
        /** Delay after navigation before the first snapshot. @default 600 @minimum 0 @maximum 10000 */
        settleMs?: number;
        /** Pause between re-snapshots while content is still growing. @default 700 @minimum 0 @maximum 5000 */
        stabilizeMs?: number;
        /** Maximum snapshots taken while waiting for content to stabilize. @default 4 @minimum 1 @maximum 10 */
        maxAttempts?: number;
        /** Prefer article/main content over the full page body. @default true */
        readable?: boolean;
    },
): Promise<{
    url: string;
    title: string;
    markdown: string;
    truncated: boolean;
    attempts: number;
    durationMs: number;
}> {
    const url = String(opts.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('websearch.read: url must be HTTP or HTTPS');
    const maxChars = Math.max(1_000, Math.min(50_000, Math.trunc(Number(opts.maxChars ?? 30_000))));
    const settleMs = Math.max(0, Math.min(10_000, Math.trunc(Number(opts.settleMs ?? 600))));
    const stabilizeMs = Math.max(0, Math.min(5_000, Math.trunc(Number(opts.stabilizeMs ?? 700))));
    const maxAttempts = Math.max(1, Math.min(10, Math.trunc(Number(opts.maxAttempts ?? 4))));
    const readable = opts.readable !== false;

    const browserSession = `webread-${Bun.randomUUIDv7()}`;
    const startedAt = performance.now();
    try {
        await ctx.fns.browser.navigate({ session: browserSession, url, settleMs });
        let best = { url, title: '', content: '', truncated: false };
        let attempts = 0;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (attempt > 0 && stabilizeMs > 0) await Bun.sleep(stabilizeMs);
            const page = await ctx.fns.browser.snapshot({
                session: browserSession,
                mode: 'markdown',
                readable,
                maxChars,
            });
            attempts = attempt + 1;
            const content = String(page.content ?? '').trim();
            if (content.length > best.content.length) {
                best = {
                    url: page.url || url,
                    title: page.title || '',
                    content,
                    truncated: Boolean(page.truncated),
                };
            } else if (attempt > 0) {
                // Length stopped growing: the page has settled.
                break;
            }
            if (best.truncated) break;
        }
        if (!best.content) throw new Error('websearch.read: page has no readable content');
        return {
            url: best.url,
            title: best.title,
            markdown: best.content,
            truncated: best.truncated,
            attempts,
            durationMs: Math.round(performance.now() - startedAt),
        };
    } finally {
        await ctx.fns.browser.tabClose({ session: browserSession }).catch(() => undefined);
    }
}
