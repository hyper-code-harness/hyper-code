/**
 * Ranks unread News items by how well they match the reader's interests using Jev scores.
 *
 * Builds an interest profile from the user's liked News items (plus an optional explicit interest description) and asks Jev one ordered score question per unread item: pass, skim, read or must read. Returns unread items sorted by expected interest with verdict, confidence and total cost. Use to triage the unread News backlog or to surface what to read first; it does not mark items read or change News state.
 * @param opts.limit Maximum unread items to rank. @default 50 @minimum 1 @maximum 200
 * @param opts.source Restrict ranking to one News source key.
 * @param opts.interests Plain-language description of the reader's interests; defaults to the profile derived from liked-item categories.
 * @param opts.likedSample How many recently liked items to include as interest examples. @default 60 @minimum 5 @maximum 100
 * @param opts.concurrency Concurrent Jev requests. @default 12 @minimum 1 @maximum 32
 * @param opts.model Jev model id override passed to jev.decide.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Maximum unread items to rank. @default 50 @minimum 1 @maximum 200 */
        limit?: number;
        /** Restrict ranking to one News source key. */
        source?: string;
        /** Plain-language description of the reader's interests; defaults to the profile derived from liked-item categories. */
        interests?: string;
        /** How many recently liked items to include as interest examples. @default 60 @minimum 5 @maximum 100 */
        likedSample?: number;
        /** Concurrent Jev requests. @default 12 @minimum 1 @maximum 32 */
        concurrency?: number;
        /** Jev model id override passed to jev.decide. */
        model?: string;
    },
): Promise<{ ranked: Array<{ id: string; title: string; source: string; url: string | null; score: number; verdict: string; confidence: number; failed: boolean; rank: number }>; counts: Record<string, number>; likedExamples: number; cost: number; latencyMs: number }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    const concurrency = Math.min(32, Math.max(1, opts.concurrency ?? 12));
    const startedAt = Date.now();
    const short = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    
    // Interest profile: explicit text, or examples drawn from liked items.
    const liked: any[] = await ctx.fns.news.list({ liked: true, limit: Math.min(100, Math.max(5, opts.likedSample ?? 60)) });
    const examples = liked
        .map((r) => short(r.title, 120) + (r.summary ? " — " + short(r.summary, 140) : ""))
        .filter((s) => s.length > 25);
    const interests = opts.interests ?? "PostgreSQL and databases; LLM models and ML research; AI agents and developer tools; healthcare IT (FHIR, OHDSI, clinical data); medicine and health systems.";
    
    let unread: any[] = await ctx.fns.news.list({ unread: true, limit: Math.min(100, limit), ...(opts.source ? { source: opts.source } : {}) });
    if (limit > 100) unread = unread.concat(await ctx.fns.news.list({ unread: true, limit: limit - 100, offset: 100, ...(opts.source ? { source: opts.source } : {}) }));
    
    const levels = [
        "Pass: unrelated to the reader's interests or low-value noise",
        "Skim: loosely related or minor news in an interest area",
        "Read: clearly within the reader's interests and substantive",
        "Must read: central to the reader's interests and unusually valuable or novel",
    ];
    const verdicts = ["pass", "skim", "read", "must"] as const;
    let cost = 0;
    let next = 0;
    const results: Array<{ id: string; title: string; source: string; url: string | null; score: number; verdict: string; confidence: number; failed: boolean }> = [];
    const worker = async (): Promise<void> => {
        for (;;) {
            const item = unread[next++];
            if (!item) return;
            const base = { id: String(item.id), title: short(item.title, 200), source: String(item.source ?? ""), url: item.url ?? null };
            try {
                const out: any = await ctx.fns.jev.decide({
                    state: {
                        reader: { interests, recentlyLiked: examples },
                        item: { source: item.source_label ?? item.source, title: short(item.title, 200), summary: short(item.summary, 400) },
                    },
                    questions: {
                        value: { type: "score", instructions: "How much would this reader, judged by `reader.interests` and `reader.recentlyLiked`, want to read `item`?", criteria: levels },
                    },
                    timeoutMs: 8000,
                    ...(opts.model ? { model: opts.model } : {}),
                });
                cost += out.usage?.cost ?? 0;
                const a = out.answers.value;
                const probs: Record<string, number> = a?.probabilities ?? {};
                const expected = Object.entries(probs).reduce((s, [k, p]) => s + Number(k) * Number(p), 0) / (levels.length - 1);
                results.push({ ...base, score: Math.round(expected * 1000) / 1000, verdict: verdicts[Math.round(Number(a?.score ?? 0))] ?? "pass", confidence: a?.confidence ?? 0, failed: false });
            } catch {
                results.push({ ...base, score: 0, verdict: "error", confidence: 0, failed: true });
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, unread.length) }, worker));
    results.sort((x, y) => y.score - x.score);
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    return { ranked: results.map((r, i) => ({ ...r, rank: i + 1 })), counts, likedExamples: examples.length, cost, latencyMs: Date.now() - startedAt };
}
