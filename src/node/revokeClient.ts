/**
 * Revoke a client Hyper's token so this host stops relaying for it
 * @param opts.id Client id from node.clients.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Client id. */ id: string }): Promise<{ revoked: boolean }> {
    const r = await ctx.fns.procs.db.run({ sql: "UPDATE llm_node_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", params: [Date.now(), String(opts.id)] });
    ctx.fns.procs.events.refresh({ topic: "node-clients", reason: "revoked" });
    return { revoked: Number(r?.changes ?? 0) > 0 };
}
