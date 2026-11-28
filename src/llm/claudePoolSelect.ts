/**
 * Choose the shared current managed Claude subscription and skip exhausted accounts
 *
 * When llm.claudeSubscriptionPool is enabled, preserve one current account in Postgres for every local and relayed Claude subscription call. Compare-and-swap keeps concurrent selectors aligned. Record a failed-account cooldown separately from usage snapshots so late successful responses cannot erase it. Does not read tokens or perform inference; expired access tokens remain refreshable. All accounts blocked returns the earliest eligible reset time.
 * @param opts.preferredAccount Explicit manual choice of a connected, unspent managed account; becomes current for all local chats and inbound relay calls.
 * @param opts.failedAccount Account whose subscription quota was just confirmed exhausted; do not use for generic HTTP throttling or authentication failures.
 * @param opts.resetsAt Confirmed quota reset time in epoch milliseconds for failedAccount; absent or past uses a one-hour cooldown.
 * @param opts.now Epoch milliseconds used for deterministic quota-expiry tests; defaults to the current clock.
 * @param opts.readOnly Validate and preview the selection without persisting a current account; incompatible with failedAccount. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Explicit manual choice of an unspent managed account; changes the shared current account for all local chats and incoming relay requests. */
        preferredAccount?: string;
        /** Account whose subscription quota was just confirmed exhausted; do not use for generic HTTP throttling or authentication failures. */
        failedAccount?: string;
        /** Confirmed quota reset time in epoch milliseconds for failedAccount; absent or past uses a one-hour cooldown. */
        resetsAt?: number | null;
        /** Epoch milliseconds used for deterministic quota-expiry tests; defaults to the current clock. */
        now?: number;
        /** Validate and preview without changing the shared current account; cannot report a failure. @default false */
        readOnly?: boolean;
    },
): Promise<{ enabled: boolean; account: string | null; resetsAt: number | null; accounts: Array<{ account: string; available: boolean; resetsAt: number | null }> }> {
    if (opts.readOnly && opts.failedAccount) throw new Error("A read-only Claude selection cannot report a failure");
    const enabled = await ctx.fns.settings.get({ module: "llm", scopeType: "global", key: "claudeSubscriptionPool" }) === true;
    if (opts.preferredAccount !== undefined && (!opts.preferredAccount.trim() || opts.failedAccount)) throw new Error("Choose one nonempty Claude account without a failure report");
    if (!enabled) {
        if (opts.preferredAccount) throw new Error("Shared Claude subscription pool is disabled");
        return { enabled: false, account: null, resetsAt: null, accounts: [] };
    }
    const now = opts.now ?? Date.now();
    const currentKey = "llm:claude-pool:current";
    if (opts.failedAccount) {
        // Separate cooldowns prevent a late successful response from erasing a quota failure.
        const until = opts.resetsAt && opts.resetsAt > now ? opts.resetsAt : now + 3_600_000;
        await ctx.fns.procs.db.run({
            sql: "INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = GREATEST(kv.value::bigint, EXCLUDED.value::bigint)::text",
            params: [`llm:claude-pool:blocked:${opts.failedAccount}`, String(Math.ceil(until))],
        });
    }
    for (let retry = 0; retry < 12; retry++) {
        // Read current BEFORE inventory: compare-and-swap below rejects concurrent switches.
        const previous = (await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key=?", params: [currentKey] }))[0]?.value as string | undefined;
        const rows = await ctx.fns.procs.db.select({
            sql: "SELECT c.account, u.value AS usage, b.value AS blocked FROM oauth_credentials c LEFT JOIN kv u ON u.key = 'llm:usage:anthropic-oauth:' || c.account LEFT JOIN kv b ON b.key = 'llm:claude-pool:blocked:' || c.account WHERE c.provider=? ORDER BY c.account",
            params: ["anthropic-oauth"],
        });
        if (!rows.length) {
            if (opts.preferredAccount) throw new Error("No managed Claude subscriptions are connected");
            // An enabled but empty pool must never fall back to local CLI credentials.
            return { enabled: true, account: null, resetsAt: null, accounts: [] };
        }
        const accounts = rows.map(row => {
            let snapshot: { updatedAt?: number; windows?: Record<string, { usedPercent?: number; resetsAt?: number | null }> } = {};
            if (row.usage) {
                try { snapshot = JSON.parse(row.usage); }
                catch (cause) { throw new Error(`Invalid stored Claude quota for ${row.account}`, { cause }); }
            }
            const blocked = Number(row.blocked) || 0;
            const deadlines = Object.values(snapshot.windows ?? {}).filter(w => Number(w.usedPercent) >= 100).map(w =>
                w.resetsAt ?? (Number(snapshot.updatedAt) || now) + 3_600_000,
            ).filter(at => at > now);
            if (blocked > now) deadlines.push(blocked);
            // Both weekly and five-hour quota must recover before this credential is usable.
            const resetsAt = deadlines.length ? Math.max(...deadlines) : null;
            return { account: String(row.account), available: resetsAt === null, resetsAt };
        });
        const preferred = opts.preferredAccount ? accounts.find(a => a.account === opts.preferredAccount) : undefined;
        if (opts.preferredAccount && !preferred?.available) throw new Error(`Claude account ${opts.preferredAccount} is missing or its quota is exhausted`);
        const current = preferred ?? accounts.find(a => a.account === previous && a.available) ?? accounts.find(a => a.available);
        const account = current?.account ?? null;
        const next = account ?? "";
        if (!opts.readOnly && previous !== next) {
            const saved = previous === undefined
                ? await ctx.fns.procs.db.run({ sql: "INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING RETURNING key", params: [currentKey, next] })
                : await ctx.fns.procs.db.run({ sql: "UPDATE kv SET value=? WHERE key=? AND value=? RETURNING key", params: [next, currentKey, previous] });
            if (!saved.changes) continue;
        }
        return { enabled: true, account, resetsAt: account ? null : Math.min(...accounts.map(a => a.resetsAt ?? now + 3_600_000)), accounts };
    }
    throw new Error("Claude pool selection changed repeatedly; retry the request");
}
