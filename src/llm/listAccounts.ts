// Which credentials exist, and how much quota each has left.
//
// This is what makes "switch account" a real choice rather than a guess: a
// second ChatGPT or Claude login is only useful if you can see that it still
// has room while the current one is spent.
/** Lists every configured subscription credential with its remaining quota. */
/**
 * Enumerate the credential accounts available per subscription provider.
 *
 * Combines file-backed logins (~/.codex/auth.json and its named siblings,
 * ~/.kimi/credentials), managed OAuth rows and the recorded quota snapshots,
 * and marks which accounts are currently exhausted. Use it to render an account
 * switcher or to pick a fallback credential. Credential inventory is cached for
 * five seconds with singleflight; quota, reconnect health and node status stay
 * live. Credential changes must delete ctx.state.llm.accountInventoryCache.
 *
 * @param opts.provider Restrict the listing to one provider.
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: {
        /** Only list accounts of this provider, e.g. "codex". */
        provider?: string;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<Array<{
    provider: string;
    account: string;
    label: string;
    model: string;
    source: "file" | "oauth" | "keychain" | "node";
    available: boolean;
    usedPercent: number | null;
    resetsAt: number | null;
    planType: string | null;
    resetCredits: types.llm.UsageSnapshot["resetCredits"];
    parkedAgents: number;
    needsReconnect: boolean;
}>> {
    const now = opts?.now ?? Date.now();
    const filter = opts?.provider;
    const out: any[] = [];

    const usage = await ctx.fns.llm.usageOverview({ now });
    const byKey = new Map(usage.map((u: any) => [`${u.provider}:${u.account}`, u]));
    const health = await ctx.fns.llm.accountAuthHealth({ action: "list" });
    const reconnectKeys = new Set(health.filter((item: any) => item.needsReconnect).map((item: any) => `${item.provider}:${item.account}`));

    for (const credential of await inventory(ctx, filter)) {
        const item = entry(credential.provider, credential.account, credential.source, byKey, reconnectKeys);
        if (credential.label) item.label = credential.label;
        if (credential.expiresAt !== undefined && credential.expiresAt <= now) {
            item.needsReconnect = true; item.available = false;
        }
        out.push(item);
    }
    if ((!filter || filter === "claude-code") && !out.some((a) => a.provider === "claude-code" && a.account === "default") && byKey.has("claude-code:default")) {
        out.push(entry("claude-code", "default", "keychain", byKey, reconnectKeys));
    }

    // Hyper nodes (docs/hyper-node.md): one row per node; quota is the node's
    // most-used provider we are allowed to use, from its cached usage snapshot.
    if (!filter || filter === "hyper") {
        let nodes: types.node.NodeEntry[] = [];
        try { nodes = await ctx.fns.node.list({}); } catch { nodes = []; }
        for (const node of nodes) {
            const item = entry("hyper", node.name, "node", byKey, reconnectKeys);
            item.label = `hyper/${node.name}`;
            item.model = `hyper/${node.name}:`;
            const worst = [...(node.usage ?? [])].sort((a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0))[0];
            if (worst) { item.usedPercent = worst.usedPercent; item.resetsAt = worst.resetsAt; item.planType = worst.planType; }
            if (!node.enabled || node.lastError) { item.available = false; item.needsReconnect = Boolean(node.lastError); }
            (item as any).nodeUrl = node.url; (item as any).models = node.catalog?.length ?? 0; (item as any).error = node.lastError;
            out.push(item);
        }
    }

    return out;
}

function entry(provider: string, account: string, source: "file" | "oauth" | "keychain" | "node", byKey: Map<string, any>, reconnectKeys: Set<string>) {
    const known = byKey.get(`${provider}:${account}`);
    const usedPercent = known?.usedPercent ?? null;
    const needsReconnect = reconnectKeys.has(`${provider}:${account}`);
    return {
        provider,
        account,
        label: account === "default" ? provider : `${provider} · ${account}`,
        model: known?.model ?? `${provider}${account === "default" ? "" : `/${account}`}:`,
        source,
        // "Available" means there is quota left to switch INTO — the whole point
        // of listing accounts while one of them is exhausted.
        available: !needsReconnect && !(known?.parkedAgents > 0) && (usedPercent == null || usedPercent < 100),
        needsReconnect,
        usedPercent,
        resetsAt: known?.resetsAt ?? null,
        planType: known?.planType ?? null,
        resetCredits: known?.resetCredits ?? null,
        parkedAgents: known?.parkedAgents ?? 0,
    };
}

type Credential = {
    provider: string;
    account: string;
    source: "file" | "oauth" | "keychain";
    label?: string;
    expiresAt?: number;
};

async function inventory(ctx: Context, filter?: string): Promise<Credential[]> {
    type Cached = { value?: Credential[]; expiresAt: number; pending?: Promise<Credential[]> };
    const root = ((ctx.state as { llm?: { accountInventoryCache?: Map<string, Cached> } }).llm ??= {});
    const cache = (root.accountInventoryCache ??= new Map());
    const key = JSON.stringify([filter ?? "", ctx.env.HOME ?? process.env.HOME, ctx.env.USER ?? process.env.USER]);
    const known = cache.get(key);
    if (known?.pending) return known.pending;
    if (known?.value && known.expiresAt > Date.now()) return known.value;
    for (const [id, value] of cache) if (!value.pending && value.expiresAt <= Date.now()) cache.delete(id);
    const current: Cached = { expiresAt: 0 };
    cache.set(key, current);
    current.pending = (async () => {
        const credentials: Credential[] = [];
        for (const [provider, path] of [["codex", ".codex/auth.json"], ["kimi-coding", ".kimi/credentials/kimi-code.json"]] as const) {
            if (filter && filter !== provider) continue;
            for (const account of await discoverFileAccounts(ctx, provider, path)) credentials.push({ provider, account, source: "file" });
        }
        for (const [stored, provider, label] of [["anthropic-oauth", "anthropic-oauth", "Claude managed"], ["xai-oauth", "xai", "Grok managed"]] as const) {
            if (filter && filter !== stored && filter !== provider && !(stored === "anthropic-oauth" && filter === "claude-code")) continue;
            const rows = await ctx.fns.procs.db.select({
                sql: "SELECT account, label, expires_at FROM oauth_credentials WHERE provider = ? ORDER BY account", params: [stored],
            }) as Array<{ account: string | null; label: string | null; expires_at: number | null }>;
            for (const row of rows) {
                const account = String(row.account ?? "default");
                credentials.push({ provider, account, source: "oauth", label: row.label ? String(row.label) : (account === "default" ? label : account), expiresAt: Number(row.expires_at) });
            }
        }
        if (!filter || filter === "claude-code") {
            const accounts = await discoverDirectoryAccounts(ctx, "claude-code");
            const exists = await Promise.all(accounts.map((account) => ctx.fns.llm.accountCredentialExists({ provider: "claude-code", account })));
            accounts.forEach((account, index) => { if (exists[index]) credentials.push({ provider: "claude-code", account, source: "keychain" }); });
        }
        current.value = credentials;
        current.expiresAt = Date.now() + 5_000;
        return credentials;
    })();
    try { return await current.pending; }
    finally { delete current.pending; }
}

async function discoverFileAccounts(ctx: Context, provider: "codex" | "kimi-coding", relative: string): Promise<string[]> {
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    if (!home) return [];
    const accounts: string[] = [];
    try {
        const { existsSync, readdirSync } = require("node:fs");
        if (existsSync(`${home}/${relative}`)) accounts.push("default");
        const root = `${home}/.hyper/accounts/${provider}`;
        for (const account of readdirSync(root) as string[]) {
            const { file } = ctx.fns.llm.accountCredentialPath({ provider, account });
            if (file && existsSync(file)) accounts.push(account);
        }
    } catch { return accounts; }
    return accounts;
}

async function discoverDirectoryAccounts(ctx: Context, provider: "claude-code"): Promise<string[]> {
    const home = ctx.env.HOME ?? process.env.HOME ?? "";
    const accounts = ["default"];
    try {
        const { readdirSync } = require("node:fs");
        for (const account of readdirSync(`${home}/.hyper/accounts/${provider}`) as string[]) if (account !== "default") accounts.push(account);
    } catch { /* only the default login exists */ }
    return accounts;
}
