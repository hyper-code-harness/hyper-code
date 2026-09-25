// Judges duplicate candidates that no identifier can settle.
//
// The pairs that reach here are exactly the ambiguous ones: "Eugene Vestel" and
// "Gene Vestel" are the same man, "Carl Anderson" and "Gary Anderson" are not,
// and both pairs sit at edit distance 2. String metrics cannot separate them
// and embeddings barely try, so each pair is put to a typed decision model as
// a yes/no question over the two full records.
//
// Three properties make this safe enough to run in bulk. Every pair becomes its
// own question inside one request, so pairs never influence each other. The
// full record travels with the question, because context decides more than the
// name — the same name at different employers is usually two people. And
// nothing is merged here: the verdict is a band, and only the caller acts.

/** Scores ambiguous duplicate pairs with a typed decision model and sorts them into merge, review and distinct bands. */
/**
 * Decide which duplicate candidate pairs are really the same entity.
 *
 * Use on the pairs `knowledge.dedupCandidates` marks `weak` or `strong`, where
 * names are similar but no shared identifier proves anything. Each pair is
 * judged on its full record, in batched single-round-trip requests, and lands
 * in one of three bands: `merge` above the high threshold, `review` in between,
 * `distinct` below the low one.
 *
 * Decides only; `knowledge.dedupMerge` performs the merge. Pairs already marked
 * `distinct_from` are dropped before any model call.
 *
 * @param opts.type Entity type to judge.
 * @param opts.pairs Explicit pairs to judge; omit to take them from dedupCandidates.
 * @param opts.strength Candidate strengths to judge when pairs are not supplied.
 * @param opts.high Probability at or above which a pair is proposed for merge.
 * @param opts.low Probability below which a pair is reported as distinct.
 * @param opts.batch Pairs sent per request as independent parallel questions.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Entity type to judge. @default Person */
    type?: string;
    /** Explicit pairs to judge, bypassing candidate generation. */
    pairs?: Array<{ left: string; right: string }>;
    /** Candidate strengths taken from dedupCandidates. @default ["weak","strong"] */
    strength?: Array<"identifier" | "strong" | "weak">;
    /** Probability at or above which a pair is proposed for merge. @default 0.8 @minimum 0 @maximum 1 */
    high?: number;
    /** Probability below which a pair is called distinct. @default 0.4 @minimum 0 @maximum 1 */
    low?: number;
    /** Pairs per request, each as its own independent question. @default 12 @minimum 1 @maximum 40 */
    batch?: number;
    /** Maximum pairs judged in one call. @default 100 @minimum 1 @maximum 500 */
    limit?: number;
}): Promise<{
    type: string;
    judged: number;
    merge: Array<{ left: string; right: string; leftName: string; rightName: string; score: number }>;
    review: Array<{ left: string; right: string; leftName: string; rightName: string; score: number }>;
    distinct: Array<{ left: string; right: string; leftName: string; rightName: string; score: number }>;
    skipped: number;
    latencyMs: number;
}> {
    await ctx.fns.knowledge.ensure({});
    const type = opts.type ?? "Person";
    const high = Math.min(1, Math.max(0, opts.high ?? 0.8));
    const low = Math.min(high, Math.max(0, opts.low ?? 0.4));
    const batch = Math.min(40, Math.max(1, opts.batch ?? 12));
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const startedAt = Date.now();

    let wanted: Array<{ left: string; right: string }>;
    if (opts.pairs?.length) {
        wanted = opts.pairs;
    } else {
        const strengths = new Set(opts.strength ?? ["weak", "strong"]);
        const candidates = await ctx.fns.knowledge.dedupCandidates({ type, limit: 2000 });
        wanted = candidates.pairs.filter((pair) => strengths.has(pair.strength)).map((pair) => ({ left: pair.left, right: pair.right }));
    }
    wanted = wanted.slice(0, limit);
    if (!wanted.length) return { type, judged: 0, merge: [], review: [], distinct: [], skipped: 0, latencyMs: 0 };

    const ids = [...new Set(wanted.flatMap((pair) => [pair.left, pair.right]))];
    const rows: any[] = await ctx.fns.procs.db.select({
        sql: `SELECT id, data FROM knowledge.entities WHERE id IN (${ids.map(() => "?").join(",")})`,
        params: ids,
    });
    const byId = new Map<string, any>(rows.map((row) => [String(row.id), row.data ?? {}]));

    const merge: any[] = [], review: any[] = [], distinct: any[] = [];
    let skipped = 0;
    const pending: Array<{ left: string; right: string; leftData: any; rightData: any }> = [];
    for (const pair of wanted) {
        const leftData = byId.get(pair.left), rightData = byId.get(pair.right);
        if (!leftData || !rightData) { skipped++; continue; }
        // A recorded "these are different" verdict is final and costs nothing
        // to honour; re-asking would eventually flip it by chance.
        const marked = ([] as string[])
            .concat(leftData.distinct_from ?? [], rightData.distinct_from ?? [])
            .map((value: string) => String(value).toLowerCase());
        if (marked.includes(pair.left.toLowerCase()) || marked.includes(pair.right.toLowerCase())) { skipped++; continue; }
        pending.push({ ...pair, leftData, rightData });
    }

    for (let offset = 0; offset < pending.length; offset += batch) {
        const slice = pending.slice(offset, offset + batch);
        const questions: Record<string, types.jev.Question> = {};
        slice.forEach((pair, index) => {
            questions[`p${index}`] = {
                type: "noul",
                instructions: { question: "Are these two records the same real entity?", left: summarize(pair.leftData), right: summarize(pair.rightData) },
                criteria: {
                    true: "The same one, written with a different spelling, nickname, transliteration, title or level of detail",
                    false: "Two different ones who merely have similar names",
                },
            };
        });
        let answers: Record<string, types.jev.Answer>;
        try {
            const out = await ctx.fns.jev.decide({
                state: `Deduplicating a ${type} table in a knowledge graph. Records may use nicknames, academic titles, transliteration between scripts, or different levels of completeness. Distinguishing context such as employer, role or location outweighs name similarity.`,
                questions,
            });
            answers = out.answers;
        } catch (error: any) {
            ctx.fns.procs.log.warn({ event: "knowledge.dedup-decide.failed", msg: String(error?.message ?? error) });
            skipped += slice.length;
            continue;
        }
        slice.forEach((pair, index) => {
            const answer = answers[`p${index}`];
            const score = answer && answer.type === "noul" ? answer.noul : 0;
            const record = {
                left: pair.left, right: pair.right,
                leftName: name(pair.leftData), rightName: name(pair.rightData),
                score,
            };
            if (score >= high) merge.push(record);
            else if (score >= low) review.push(record);
            else distinct.push(record);
        });
    }

    const bySore = (a: any, b: any) => b.score - a.score;
    return {
        type,
        judged: merge.length + review.length + distinct.length,
        merge: merge.sort(bySore),
        review: review.sort(bySore),
        distinct: distinct.sort(bySore),
        skipped,
        latencyMs: Date.now() - startedAt,
    };
}

// Only the fields that actually discriminate. Sending the whole record wastes
// tokens on avatars and ids, and buries the employer that decides the answer.
function summarize(data: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const field of ["title", "name", "aka", "headline", "role", "org", "employer", "location", "city", "country", "email", "work_email", "telegram", "github", "linkedin", "description", "bio"]) {
        const value = data?.[field];
        if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
        out[field] = typeof value === "string" ? value.slice(0, 300) : value;
    }
    return out;
}

function name(data: Record<string, any>): string {
    return String(data?.title ?? data?.name ?? "").trim();
}
