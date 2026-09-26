// What this instance can serve to a node client: every model of its own
// providers the client is allowed to use, plus (chaining) models reachable
// through its own nodes, marked with `via`. Local-only providers (LM Studio)
// and mocks are never shared.
/**
 * Build the model catalogue this host offers to one node client
 *
 * Lists own provider models filtered by the client's provider allow-list and,
 * unless excluded, models reachable through this host's own nodes (chained,
 * with `via`). Each entry carries the wire api and billing kind the client
 * needs to build and classify requests.
 * @param opts.providers Provider allow-list; empty means every shareable provider.
 * @param opts.excludeNode Node name not to chain back into (the requesting client).
 * @param opts.hops Current hop count; chained entries are omitted at the limit.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider allow-list; empty means every shareable provider. */
        providers?: string[];
        /** Node name not to chain back into. */
        excludeNode?: string;
        /** Current hop count. @default 0 */
        hops?: number;
    },
): Promise<Array<{ id: string; api: "anthropic" | "responses" | "openai"; provider: string; account: string; kind: "subscription" | "api"; via?: string }>> {
    const allow = new Set((opts.providers ?? []).filter(Boolean));
    // Own models only from listModels; node models come from the cache below.
    // listModels would refresh nodes, and a node that points back at us would
    // recurse through our own /models until the hop limit.
    const all = await ctx.fns.llm.listModels({ skipNodes: true });
    const out: Array<{ id: string; api: "anthropic" | "responses" | "openai"; provider: string; account: string; kind: "subscription" | "api"; via?: string }> = [];
    const seen = new Set<string>();
    for (const [group, models] of Object.entries(all)) {
        if (group === "lmstudio" || group === "mock") continue;
        for (const full of models) {
            const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:(.+)$/.exec(full);
            if (!m) continue;
            const provider = m[1]!, account = m[2] ?? "default", id = m[3]!;
            if (allow.size && !allow.has(provider)) continue;
            let ep;
            try { ep = await ctx.fns.llm.resolveEndpoint({ model: full }); } catch { continue; }
            if (ep.api === "mock" || ep.kind === "local" || seen.has(id)) continue;
            seen.add(id);
            out.push({ id, api: ep.api, provider, account, kind: ep.kind });
        }
    }
    // Chained: what our own nodes offer, from their cached catalogue only, one
    // hop deeper. Never the node the requesting client is (a loop), never past
    // the hop limit, and never a model we already serve ourselves.
    if ((opts.hops ?? 0) < 2) {
        let nodes: types.node.NodeEntry[] = [];
        try { nodes = await ctx.fns.node.list({}); } catch { nodes = []; }
        for (const node of nodes) {
            if (!node.enabled || node.name === opts.excludeNode) continue;
            for (const entry of node.catalog ?? []) {
                if (entry.via || seen.has(entry.id)) continue;
                if (allow.size && !allow.has(entry.provider)) continue;
                seen.add(entry.id);
                out.push({ id: entry.id, api: entry.api, provider: entry.provider, account: entry.account, kind: entry.kind, via: `hyper/${node.name}` });
            }
        }
    }
    return out;
}
