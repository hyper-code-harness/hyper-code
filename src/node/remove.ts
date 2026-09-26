/**
 * Remove a configured Hyper node and its stored token
 * @param opts.name Node name.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Node name. */ name: string }): Promise<{ removed: boolean }> {
    const r = await ctx.fns.procs.db.run({ sql: "DELETE FROM llm_nodes WHERE name = ?", params: [String(opts.name)] });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM local_secrets WHERE namespace = 'node' AND name = ?", params: [`token:${String(opts.name)}`] });
    ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "node-removed" });
    return { removed: Number(r?.changes ?? 0) > 0 };
}
