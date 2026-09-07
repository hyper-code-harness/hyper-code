// Authorized Google accounts are metadata stored separately from token values.
/**
 * List configured Google accounts.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const found = new Set<string>();
    const raw = await ctx.fns.secrets.get({ ref: "op://hyper/google/accounts", namespace: "google", name: "accounts" });
    if (raw) {
        const accounts = JSON.parse(raw);
        if (Array.isArray(accounts)) for (const value of accounts) if (typeof value === "string") found.add(value);
    }
    // Reauth tokens are authoritative too: discovering their non-secret names
    // keeps the account list correct even if old metadata was never updated.
    const rows = await ctx.fns.procs.db.select({
        sql: "SELECT name FROM local_secrets WHERE namespace = ? AND name LIKE 'token:%' ORDER BY name",
        params: ["google"],
    }).catch(() => [] as any[]) as any[];
    for (const row of rows) {
        const account = String(row.name ?? "").slice("token:".length);
        if (account.includes("@")) found.add(account);
    }
    return [...found].sort();
}
