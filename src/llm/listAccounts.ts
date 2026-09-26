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
 * switcher or to pick a fallback credential.
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

    // File-backed logins: the default path plus every "auth.<account>.json"
    // sibling. One naming convention, so a second login needs no new code.
    for (const [provider, path] of [["codex", ".codex/auth.json"], ["kimi-coding", ".kimi/credentials/kimi-code.json"]] as const) {
        if (filter && filter !== provider) continue;
        for (const account of await discoverFileAccounts(ctx, provider, path)) {
            out.push(entry(provider, account, "file", byKey, reconnectKeys));
        }
    }

    // Managed OAuth rows are presented as normal Claude accounts in user-facing
    // UI. The runtime transport remains anthropic-oauth, but a person should not
    // need that implementation detail to understand or switch accounts.
    if (!filter || filter === "anthropic-oauth" || filter === "claude-code") {
        const rows = (await ctx.fns.procs.db.select({
            sql: "SELECT account, label, expires_at FROM oauth_credentials WHERE provider = ? ORDER BY account",
            params: ["anthropic-oauth"],
        })) as any[];
        for (const row of rows) {
            const item = entry("anthropic-oauth", String(row.account ?? "default"), "oauth", byKey, reconnectKeys);
            item.label = row.label ? String(row.label) : (item.account === "default" ? "Claude managed" : item.account);
            out.push(item);
            if (Number(row.expires_at) <= now) { item.needsReconnect = true; item.available = false; }
        }
    }


    // xAI managed device-OAuth credentials are exposed under the runtime model
    // provider (`xai`) rather than their persistence adapter (`xai-oauth`).
    if (!filter || filter === "xai" || filter === "xai-oauth") {
        const rows = (await ctx.fns.procs.db.select({
            sql: "SELECT account, label, expires_at FROM oauth_credentials WHERE provider = ? ORDER BY account",
            params: ["xai-oauth"],
        })) as any[];
        for (const row of rows) {
            const item = entry("xai", String(row.account ?? "default"), "oauth", byKey, reconnectKeys);
            item.label = row.label ? String(row.label) : (item.account === "default" ? "Grok managed" : item.account);
            if (Number(row.expires_at) <= now) { item.needsReconnect = true; item.available = false; }
            out.push(item);
        }
    }

    // Claude Code accounts live in isolated CLAUDE_CONFIG_DIRs. On macOS the
    // actual tokens are in keychain services derived from those directories;
    // the directory itself is the durable account registry.
    if (!filter || filter === "claude-code") {
        for (const account of await discoverDirectoryAccounts(ctx, "claude-code")) {
            if (ctx.fns.llm.accountCredentialExists({ provider: "claude-code", account })) {
                out.push(entry("claude-code", account, "keychain", byKey, reconnectKeys));
            }
        }
        if (!out.some((a) => a.provider === "claude-code" && a.account === "default") && byKey.has("claude-code:default")) {
            out.push(entry("claude-code", "default", "keychain", byKey, reconnectKeys));
        }
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
