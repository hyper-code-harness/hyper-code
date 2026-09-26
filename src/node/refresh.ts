/**
 * Fetch a Hyper node's catalogue and usage and cache them locally
 *
 * Calls GET <url>/models and GET <url>/usage with the node token, stores both
 * snapshots with timestamps, records the last error on failure. Use after
 * adding a node and periodically before listing models.
 * @param opts.name Node name.
 * @param opts.maxAgeMs Skip the fetch when the catalogue is younger than this. @default 0
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Node name. */ name: string;
    /** Skip when catalogue is younger than this many ms. @default 0 */ maxAgeMs?: number;
}): Promise<types.node.NodeEntry | null> {
    const node = await ctx.fns.node.get({ name: opts.name });
    if (!node) return null;
    if (opts.maxAgeMs && node.catalogAt && Date.now() - node.catalogAt < opts.maxAgeMs) return node;
    const token = await ctx.fns.node.token({ name: node.name });
    const headers = { authorization: `Bearer ${token}` };
    const now = Date.now();
    try {
        const [m, u] = await Promise.all([
            fetch(`${node.url}/models`, { headers, signal: AbortSignal.timeout(5000) }),
            fetch(`${node.url}/usage`, { headers, signal: AbortSignal.timeout(5000) }),
        ]);
        if (!m.ok) throw new Error(`models ${m.status}: ${(await m.text()).slice(0, 120)}`);
        const models = ((await m.json()) as any)?.models ?? [];
        const usage = u.ok ? (((await u.json()) as any)?.usage ?? []) : null;
        await ctx.fns.procs.db.run({ sql: "UPDATE llm_nodes SET catalog = ?, catalog_at = ?, usage = ?, usage_at = ?, last_error = NULL, updated_at = ? WHERE name = ?", params: [JSON.stringify(models), now, usage ? JSON.stringify(usage) : null, usage ? now : null, now, node.name] });
    } catch (e: any) {
        await ctx.fns.procs.db.run({ sql: "UPDATE llm_nodes SET last_error = ?, updated_at = ? WHERE name = ?", params: [String(e?.message ?? e).slice(0, 300), now, node.name] });
    }
    ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "node-refresh" });
    return ctx.fns.node.get({ name: node.name });
}
