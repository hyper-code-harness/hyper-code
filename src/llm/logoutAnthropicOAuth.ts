/** Deletes the stored Anthropic OAuth credentials of one account. */
/**
 * Delete stored Anthropic OAuth credentials.
 *
 * Removes one credential slot, leaving other Claude logins intact. Pass no
 * account to disconnect the default one.
 *
 * @param opts.account Credential slot to disconnect.
 * @param opts.all Remove every Anthropic OAuth account at once.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Credential slot to disconnect. @default "default" */ account?: string;
    /** Disconnect every account of this provider. @default false */ all?: boolean }): Promise<{ ok: true }> {
    const account = String(opts?.account ?? "").trim() || "default";
    if (opts?.all) {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM oauth_credentials WHERE provider = ?", params: ["anthropic-oauth"] });
    } else {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM oauth_credentials WHERE provider = ? AND account = ?", params: ["anthropic-oauth", account] });
    }
    const state = (ctx.state as typeof ctx.state & { llm?: { accountInventoryCache?: Map<string, unknown> } }).llm;
    if (state) delete state.accountInventoryCache;
    const store: any = (ctx.state as any).llm?.anthropicOAuth;
    if (store) {
        for (const p of store.pending?.values?.() ?? []) try { p.server?.close(); } catch { console.warn("[anthropic-oauth] could not close pending login server"); }
        store.pending?.clear?.();
        store.lastError = null;
    }
    return { ok: true };
}
