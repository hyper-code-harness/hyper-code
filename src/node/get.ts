/**
 * Read one configured Hyper node with its cached catalogue and usage (no token)
 * @param opts.name Node name as configured locally.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Node name. */ name: string }): Promise<types.node.NodeEntry | null> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT name, url, enabled, catalog, catalog_at, usage, usage_at, last_error FROM llm_nodes WHERE name = ?", params: [String(opts.name)] }) as any[];
    const r = rows[0]; if (!r) return null;
    const parse = (s: any) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
    return { name: String(r.name), url: String(r.url), enabled: Boolean(r.enabled), catalog: parse(r.catalog), catalogAt: r.catalog_at == null ? null : Number(r.catalog_at), usage: parse(r.usage), usageAt: r.usage_at == null ? null : Number(r.usage_at), lastError: r.last_error == null ? null : String(r.last_error) };
}
