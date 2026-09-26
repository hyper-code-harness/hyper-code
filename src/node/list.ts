/** List configured Hyper nodes with cached catalogue and usage (no tokens). */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<types.node.NodeEntry[]> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT name FROM llm_nodes ORDER BY name", params: [] }) as any[];
    const out: types.node.NodeEntry[] = [];
    for (const r of rows) { const n = await ctx.fns.node.get({ name: String(r.name) }); if (n) out.push(n); }
    return out;
}
