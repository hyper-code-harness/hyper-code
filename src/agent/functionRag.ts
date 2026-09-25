/** Retrieves compact runtime-function candidates for the latest real user prompt. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose opt-in flag and transcript are inspected. */
        agent: types.agent.Agent;
        /** Transcript used to locate the latest user message. */
        messages: any[];
    },
): Promise<{ messageIdx: number; query: string; reranked: boolean; rerankStatus: "off" | "skipped" | "ok" | "error"; needsTool: number | null; gate: "open" | "closed" | "off" | "error"; retrieved: number; functions: Array<{ name: string; summary: string; signature: string; score: number; rank: number; bm25: number | null; similarity: number | null; jev: number | null }> } | null> {
    if (opts.agent.functionRagEnabled !== true) return null;
    let messageIdx = -1;
    let query = "";
    for (let i = opts.messages.length - 1; i >= 0; i--) {
        const message = opts.messages[i];
        if (message?.role !== "user" || message?.excluded_from_cursor || message?.message_type && message.message_type !== "message") continue;
        const text = typeof message.content === "string" ? message.content.trim() : "";
        if (!text) return null;
        messageIdx = Number(message.idx ?? i);
        query = text.slice(0, 2000);
        break;
    }
    if (messageIdx < 0) return null;

    // Gate and rerank are independent. Gate scores never come from the reranker.
    const lastUser = opts.messages.findLastIndex(m => m?.role === 'user' && !m.excluded_from_cursor && (!m.message_type || m.message_type === 'message'));
    const decision = opts.agent.functionRagGateEnabled === true
        ? await ctx.fns.agent.functionRagGate({ messages: opts.messages.slice(0, lastUser + 1) }).catch(() => ({ gate: 'error' as const, score: null }))
        : { gate: 'off' as const, score: null };
    const gate = decision.gate;
    const needsTool = decision.score;
    let rerankStatus: 'off' | 'skipped' | 'ok' | 'error' = opts.agent.jevRerankEnabled === true ? 'skipped' : 'off';
    if (gate === 'closed') return { messageIdx, query, gate, needsTool, reranked: false, rerankStatus, retrieved: 0, functions: [] };

    const hits = await ctx.fns.runtime.docs.search({ query, mode: "hybrid", limit: 20 });

    // Optional second stage: a typed decision model scores each surviving
    // candidate against the prompt in ONE fan-out request. It answers the
    // question retrieval cannot — whether a lexically or semantically similar
    // function actually performs the requested operation — and reorders
    // accordingly. A failure here degrades to plain retrieval, never to no
    // functions at all.
    let jevScores: Map<string, number> | null = null;
    if (opts.agent.jevRerankEnabled === true && hits.length > 0) {
        const eligible = hits.filter((hit: any) => !String(hit.name).startsWith("tmp."));
        const reranked = await ctx.fns.jev.selectFunctions({
            query,
            candidates: eligible.map((hit: any) => ({ name: hit.name, text: `${hit.name}: ${hit.summary}\n${compactSignature(hit.signature)}` })),
            limit: 5,
            minScore: 0.3,
        }).catch((error: any) => {
            ctx.fns.procs.log.warn({ event: "agent.function-rag.jev-failed", msg: String(error?.message ?? error), agentId: opts.agent.id });
            return null;
        });
        if (reranked) {
            rerankStatus = 'ok';
            jevScores = new Map(reranked.functions.map((fn: any) => [String(fn.name), Number(fn.score)]));
        } else rerankStatus = 'error';
    }

    // RRF is rank fusion, not an absolute or calibrated relevance probability.
    const functions = hits
        .map((hit: any, index: number) => ({ ...hit, originalRank: index + 1 }))
        .filter((hit: any) => !String(hit.name).startsWith("tmp."))
        // When Jev ran, its verdict replaces the retrieval gates entirely: a
        // candidate it scored survives, one it dropped does not, whatever RRF
        // thought. Mixing the two would reintroduce the noise reranking removes.
        .filter((hit: any) => jevScores
            ? jevScores.has(String(hit.name))
            : (hit.evidence === "exact-name" || hit.evidence === "intersection" || hit.evidence === "bm25-only" || hit.evidence === "vector-only") && Number(hit.score) >= 0.015)
        .sort((a: any, b: any) => jevScores
            ? (jevScores.get(String(b.name))! - jevScores.get(String(a.name))!) || (a.originalRank - b.originalRank)
            : 0)
        .slice(0, 5)
        .map((hit: any) => ({
            name: hit.name,
            summary: hit.summary,
            signature: compactSignature(hit.signature),
            score: Number(hit.score),
            rank: Number(hit.originalRank),
            bm25: hit.bm25 == null ? null : Number(hit.bm25),
            similarity: hit.similarity == null ? null : Number(hit.similarity),
            jev: jevScores ? (jevScores.get(String(hit.name)) ?? null) : null,
        }));
    return { messageIdx, query, reranked: jevScores != null, rerankStatus, needsTool, gate, retrieved: hits.length, functions };
}


function compactSignature(signature: string): string {
    return String(signature ?? "").replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim().slice(0, 600);
}
