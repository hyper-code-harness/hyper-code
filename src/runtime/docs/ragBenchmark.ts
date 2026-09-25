// Scores runtime-function retrieval against the labelled set in ragCases.
//
// Two things are measured, and they pull in opposite directions: finding the
// right function when one exists (recall), and staying silent when none does
// (no-result precision). A retriever can trivially max either one alone.
//
// The `jev` arm reruns the same candidates through the reranker so the two
// pipelines are compared on identical retrieval output, in one command, instead
// of by hand in a throwaway script.

/** Scores runtime-function retrieval on the labelled case set, optionally comparing the Jev reranker against plain retrieval. */
/**
 * Evaluate runtime-function search quality and report recall, no-result
 * precision and overall accuracy per configuration.
 *
 * Use before and after any change to retrieval, thresholds, embeddings or
 * reranking. The `mode` option decides what is scored: cosine thresholds over
 * plain hybrid retrieval, the Jev reranking stage, or both with a delta.
 *
 * Every case carries its own verdict in `observations`, so a regression can be
 * traced to the exact prompt that flipped.
 *
 * @param opts.thresholds Cosine floors to sweep in the baseline arm.
 * @param opts.mode Which pipelines to score.
 * @param opts.source Restrict scoring to hand-written or transcript-mined cases.
 * @param opts.minScore Relevance floor applied in the Jev arm.
 * @param opts.needsToolFloor Below this needs_tool probability the Jev arm injects nothing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Cosine thresholds evaluated in the baseline arm. */
        thresholds?: number[];
        /** Pipelines to score: retrieval only, reranked only, or both. @default base */
        mode?: "base" | "jev" | "compare";
        /** Restrict to hand-written probes or transcript-mined cases. */
        source?: "synthetic" | "transcript";
        /** Minimum Jev relevance probability for a candidate to survive. @default 0.3 @minimum 0 @maximum 1 */
        minScore?: number;
        /** needs_tool probability below which the Jev arm returns nothing. @default 0.15 @minimum 0 @maximum 1 */
        needsToolFloor?: number;
    } = {},
): Promise<any> {
    const cases = ctx.fns.runtime.docs.ragCases(opts.source ? { source: opts.source } : {});
    const mode = opts.mode ?? "base";
    const thresholds = opts.thresholds ?? [0.20, 0.25, 0.28, 0.30, 0.32, 0.35, 0.38, 0.40, 0.45];
    const minScore = opts.minScore ?? 0.3;
    const needsToolFloor = opts.needsToolFloor ?? 0.15;

    // Retrieval runs once; both arms score the same candidate windows.
    const evaluated: Array<{ test: types.runtime.docs.RagCase; hits: any[] }> = [];
    for (const test of cases) {
        const hits = await ctx.fns.runtime.docs.search({ query: test.query, mode: "hybrid", limit: 20 });
        evaluated.push({ test, hits });
    }

    const baseRows = thresholds.map((threshold) => score(cases, evaluated.map(({ test, hits }) => ({
        test,
        selected: hits
            .filter((hit: any) => hit.similarity != null && Number(hit.similarity) >= threshold && !String(hit.name).startsWith("tmp."))
            .slice(0, 5)
            .map((hit: any) => String(hit.name)),
    })), { threshold }));

    let jevRow: any = null;
    let jevSelections: Array<{ test: types.runtime.docs.RagCase; selected: string[]; needsTool: number | null }> = [];
    if (mode === "jev" || mode === "compare") {
        for (const { test, hits } of evaluated) {
            const candidates = hits
                .filter((hit: any) => !String(hit.name).startsWith("tmp."))
                .map((hit: any) => ({ name: String(hit.name), text: `${hit.name}: ${hit.summary}` }));
            if (!candidates.length) { jevSelections.push({ test, selected: [], needsTool: null }); continue; }
            try {
                const reranked = await ctx.fns.jev.selectFunctions({ query: test.query, candidates, limit: 5, minScore });
                jevSelections.push({
                    test,
                    selected: reranked.needsTool < needsToolFloor ? [] : reranked.functions.map((fn) => fn.name),
                    needsTool: reranked.needsTool,
                });
            } catch (error: any) {
                ctx.fns.procs.log.warn({ event: "runtime.docs.rag-benchmark.jev-failed", msg: String(error?.message ?? error) });
                jevSelections.push({ test, selected: [], needsTool: null });
            }
        }
        jevRow = score(cases, jevSelections, { minScore, needsToolFloor });
    }

    // The baseline is reported at its best threshold, which is what a delta
    // against the reranker has to beat to mean anything.
    const bestBase = baseRows.slice().sort((a, b) => b.queryAccuracy - a.queryAccuracy || b.recallAt5 - a.recallAt5)[0];

    return {
        model: await ctx.fns.settings.getString({ module: "embeddings", scopeType: "global", key: "model" }),
        cases: cases.length,
        positives: cases.filter((test) => test.noResult !== true).length,
        negatives: cases.filter((test) => test.noResult === true).length,
        mode,
        thresholds: baseRows,
        jev: jevRow,
        delta: jevRow && bestBase ? {
            againstThreshold: bestBase.threshold,
            queryAccuracy: round(jevRow.queryAccuracy - bestBase.queryAccuracy),
            recallAt5: round(jevRow.recallAt5 - bestBase.recallAt5),
            noResultPrecision: round(jevRow.noResultPrecision - bestBase.noResultPrecision),
        } : null,
        observations: (jevSelections.length ? jevSelections : evaluated.map(({ test }) => ({ test, selected: [], needsTool: null })))
            .map(({ test, selected, needsTool }, index) => ({
                query: test.query,
                source: test.source ?? "synthetic",
                expected: test.expected,
                noResult: test.noResult === true,
                jevSelected: selected,
                needsTool,
                verdict: test.noResult === true
                    ? (selected.length ? "false-positive" : "ok")
                    : (selected.some((name) => test.expected.includes(name)) ? "ok" : "miss"),
                top: evaluated[index]!.hits.slice(0, 5).map((hit: any) => ({ name: hit.name, rrf: hit.score, bm25: hit.bm25, cosine: hit.similarity })),
            })),
    };
}

function score(
    cases: types.runtime.docs.RagCase[],
    selections: Array<{ test: types.runtime.docs.RagCase; selected: string[] }>,
    label: Record<string, number>,
): any {
    let correct = 0, expectedFound = 0, expectedTotal = 0, silentWhenSilent = 0, negatives = 0;
    for (const { test, selected } of selections) {
        if (test.noResult) {
            negatives++;
            if (!selected.length) { silentWhenSilent++; correct++; }
            continue;
        }
        expectedTotal++;
        if (selected.some((name) => test.expected.includes(name))) { expectedFound++; correct++; }
    }
    return {
        ...label,
        queryAccuracy: round(correct / (cases.length || 1)),
        recallAt5: round(expectedTotal ? expectedFound / expectedTotal : 0),
        noResultPrecision: round(negatives ? silentWhenSilent / negatives : 1),
    };
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}
