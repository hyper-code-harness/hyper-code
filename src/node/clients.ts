/**
 * List client Hypers allowed to relay through this host (never returns tokens)
 * @param opts.includeRevoked Include revoked clients. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Include revoked clients. @default false */ includeRevoked?: boolean;
}): Promise<Array<{ id: string; name: string; tokenHint: string; providers: string[]; createdAt: number; lastUsedAt: number | null; requests: number; revokedAt: number | null }>> {
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT id, name, token_hint, providers, created_at, last_used_at, requests, revoked_at FROM llm_node_clients ${opts.includeRevoked ? "" : "WHERE revoked_at IS NULL"} ORDER BY created_at DESC`, params: [] }) as any[];
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), tokenHint: String(r.token_hint), providers: String(r.providers ?? "").split(",").filter(Boolean), createdAt: Number(r.created_at), lastUsedAt: r.last_used_at == null ? null : Number(r.last_used_at), requests: Number(r.requests ?? 0), revokedAt: r.revoked_at == null ? null : Number(r.revoked_at) }));
}
