/**
 * Remove xAI subscription credentials and cancel pending device login.
 *
 * Use for account removal or explicit logout; the default removes only one
 * named account while all=true disconnects every managed xAI account.
 *
 * @param opts.account Named xAI credential slot to delete. @default "default"
 * @param opts.all Whether to delete every managed xAI credential. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Named xAI credential slot to delete. @default "default" */ account?: string;
    /** Whether to delete every managed xAI credential. @default false */ all?: boolean;
}): Promise<{ ok: true }> {
    const account = String(opts?.account ?? "").trim() || "default";
    await ctx.fns.procs.db.run(opts?.all ? { sql: "DELETE FROM oauth_credentials WHERE provider=?", params: ["xai-oauth"] } : { sql: "DELETE FROM oauth_credentials WHERE provider=? AND account=?", params: ["xai-oauth", account] });
    const state = (ctx.state as typeof ctx.state & { llm?: { accountInventoryCache?: Map<string, unknown> } }).llm;
    if (state) delete state.accountInventoryCache;
    const store: any = (ctx.state as any).llm?.xaiOAuth;
    if (store) { for (const p of store.pending?.values?.() ?? []) if (opts?.all || p.account === account) p.cancelled = true; if (opts?.all) store.pending.clear(); else store.pending.delete(account); store.lastError = null; }
    return { ok: true };
}
