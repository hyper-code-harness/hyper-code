/** Reads and updates the secret-free registry of subscription account slots. */
/**
 * Manage durable subscription account metadata without storing credentials.
 *
 * Credentials remain in the provider-owned secure store: Claude Code's macOS
 * keychain service or Codex's isolated CODEX_HOME. This registry contains only
 * `{provider, account, dir, status}` so `/llms` can distinguish a real connected
 * account from an empty directory left by a cancelled login. Mutations invalidate
 * credential/inventory/token caches and advance accountCredentialRevision so an
 * older token refresh cannot persist credentials across a login or removal.
 *
 * @param opts.action List, begin, connect, fail, or remove an account slot.
 * @param opts.provider Subscription provider.
 * @param opts.account Named credential slot.
 * @param opts.dir Isolated CLI configuration directory; contains no token in the registry itself.
 * @param opts.error Sanitized login error when action is fail.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Registry operation. */ action: "list" | "begin" | "connect" | "fail" | "remove";
    /** Subscription provider. */ provider?: "codex" | "claude-code" | "kimi-coding";
    /** Credential slot. */ account?: string;
    /** Provider-owned credential directory. */ dir?: string | null;
    /** Sanitized error message. */ error?: string | null;
}): Promise<Array<{ provider: string; account: string; dir: string | null; status: "pending" | "connected" | "failed"; error: string | null; updatedAt: number }>> {
    const key = "llm:account-registry";
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = ?", params: [key] })) as any[])[0];
    let entries: any[] = [];
    try { entries = row ? JSON.parse(String(row.value)) : []; } catch { entries = []; }
    if (opts.action === "list") return entries;
    const provider = opts.provider!;
    const account = String(opts.account ?? "").trim() || "default";
    const index = entries.findIndex((e) => e.provider === provider && e.account === account);
    if (opts.action === "remove") {
        if (index >= 0) entries.splice(index, 1);
    } else {
        const status = opts.action === "begin" ? "pending" : opts.action === "connect" ? "connected" : "failed";
        const next = { provider, account, dir: opts.dir ?? entries[index]?.dir ?? null, status, error: status === "failed" ? String(opts.error ?? "login failed").slice(0, 300) : null, updatedAt: Date.now() };
        if (index >= 0) entries[index] = next; else entries.push(next);
    }
    await ctx.fns.procs.db.run({ sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", params: [key, JSON.stringify(entries)] });
    const root = ((ctx.state as { llm?: { accountCredentialRevision?: number; accountCredentialCache?: object; accountInventoryCache?: object; claudeCodeTokens?: object } }).llm ??= {});
    root.accountCredentialRevision = (root.accountCredentialRevision ?? 0) + 1;
    delete root.accountCredentialCache;
    delete root.accountInventoryCache;
    delete root.claudeCodeTokens;
    return entries;
}
