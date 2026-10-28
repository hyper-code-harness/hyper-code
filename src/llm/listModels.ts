// Return models grouped by provider-prefix.
// LM Studio is queried live; API-key providers return a small curated static list; subscription providers get
// one set of routes per account llm.listAccounts reports. Missing/unreachable providers are omitted silently.
/**
 * List models per provider: local LM Studio, API-key providers with a configured key, every connected
 * subscription account (from llm.listAccounts, routed "<provider>/<account>:<model>", the default account as
 * "<provider>:<model>") and hyper/<node> groups from configured nodes.
 * @param opts.skipNodes Omit hyper/<node> groups and do not refresh node catalogues (host-side catalogue building). @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: { /** Omit node groups. @default false */ skipNodes?: boolean }): Promise<Record<string, string[]>> {
    // The catalogue asks LM Studio, Groq, every Hyper node and each provider's credentials — seconds of
    // work that the model popup and the new-chat form used to wait for on every open. The last answer is
    // returned at once and refreshed in the background once it is a minute old; only the very first call
    // (or a test with a fresh ctx) waits. The cache is keyed by the set of subscription accounts
    // (llm.listAccounts, milliseconds): a login, logout or reconnect — through Hyper or a CLI writing its own
    // auth file — rebuilds the catalogue on the next call, nobody has to reset it.
    const accounts = await subscriptionAccounts(ctx);
    const fingerprint = accounts.map(a => `${a.provider}/${a.account}${a.needsReconnect ? "!" : ""}`).sort().join(",");
    const key = opts?.skipNodes ? "skipNodes" : "all";
    if (!(ctx as any).state) return build(ctx, accounts, opts);
    const cache: Record<string, { at: number; fingerprint?: string; value?: Record<string, string[]>; pending?: Promise<Record<string, string[]>> }> =
        ((ctx.state as any).llmModelCatalog ??= {});
    const entry = (cache[key] ??= { at: 0 });
    const refresh = () => entry.pending ??= build(ctx, accounts, opts)
        .then(value => { entry.value = value; entry.at = Date.now(); entry.fingerprint = fingerprint; return value; })
        .finally(() => { entry.pending = undefined; });
    if (!entry.value || entry.fingerprint !== fingerprint) return refresh();
    if (Date.now() - entry.at > 60_000) refresh().catch(() => undefined);
    return entry.value;
}

type Account = { provider: string; account: string; needsReconnect: boolean };

/** Subscription accounts as llm.listAccounts knows them — the only source of which accounts exist. */
async function subscriptionAccounts(ctx: Context): Promise<Account[]> {
    try {
        const listed = await ctx.fns.llm.listAccounts({});
        return listed.filter(a => a.source !== "node").map(a => ({ provider: a.provider, account: String(a.account || "default"), needsReconnect: !!a.needsReconnect }));
    } catch { return []; /* fresh db without the account tables — no subscription groups */ }
}

/** "codex" for the default account, "codex/adam" for a named one — the route prefix llm.resolveEndpoint parses. */
const route = (provider: string, account: string) => account === "default" ? provider : `${provider}/${account}`;

async function build(ctx: Context, accounts: Account[], opts?: { skipNodes?: boolean }): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};

    // Local: LM Studio /v1/models
    const lmUrl = (ctx.env.LMSTUDIO_URL ?? "http://localhost:1234") + "/v1/models";
    try {
        const res = await fetch(lmUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
            const body: any = await res.json();
            const ids = (body.data ?? []).map((m: any) => m.id).filter(Boolean);
            if (ids.length) out.lmstudio = ids;
        }
    } catch { /* unreachable — skip */ }

    // Remote curated defaults are exposed only when their endpoint has usable
    // credentials. Static catalogues describe capabilities, not availability.
    const configured = async (model: string) => {
        try { const endpoint = await ctx.fns.llm.resolveEndpoint({ model }); return endpoint.kind === "local" || !!endpoint.apiKey; }
        catch { return false; }
    };
    if (await configured("kimi:kimi-k3")) out.kimi = [
        "kimi:kimi-k3",
        "kimi:kimi-k2.5",
        "kimi:kimi-k2-thinking-turbo",
        "kimi:kimi-k2-thinking",
    ];
    if (await configured("openai:gpt-5-codex")) out.openai = [
        "openai:gpt-5-codex",
        "openai:gpt-5.1-mini",
        "openai:gpt-4o-mini",
    ];
    // Groq: query the account catalogue live when a key is configured. Fall back
    // to a small production list so model selection still works before login.
    try {
        const endpoint = await ctx.fns.llm.resolveEndpoint({ model: "groq:openai/gpt-oss-120b" });
        if (endpoint.apiKey) {
            const res = await fetch("https://api.groq.com/openai/v1/models", {
                headers: { authorization: `Bearer ${endpoint.apiKey}` },
                signal: AbortSignal.timeout(3000),
            });
            if (res.ok) {
                const body: any = await res.json();
                const ids = (body.data ?? [])
                    .filter((m: any) => m.active !== false)
                    .map((m: any) => m.id)
                    .filter(Boolean)
                    .map((id: string) => `groq:${id}`)
                    .sort();
                if (ids.length) out.groq = ids;
            }
        }
    } catch { /* missing/invalid key or unreachable — omit */ }
    if (await configured("openrouter:anthropic/claude-sonnet-4.6")) out.openrouter = [
        "openrouter:anthropic/claude-sonnet-4.6",
        "openrouter:google/gemini-2.5-pro",
    ];

    // Cursor subscription catalogue, asked live: the key's plan decides what it
    // may run, so there is nothing sensible to hard-code. Omitted when no key
    // is configured or the call fails.
    try {
        if (await configured("cursor:composer-2.5")) {
            const ep = await ctx.fns.llm.resolveEndpoint({ model: "cursor:composer-2.5" });
            const { Cursor } = await import("@cursor/sdk");
            const models = await Cursor.models.list({ apiKey: ep.apiKey! });
            const ids = models.map((m) => `cursor:${m.id}`);
            if (ids.length) out.cursor = ids;
        }
    } catch { /* no key / unreachable — omit */ }


    // Subscription catalogues: one group per provider, one set of routes per account llm.listAccounts reports.
    // An account is never guessed here (no "is there a default login?" probe), so a named login without a
    // default one shows like any other. SUBSCRIPTIONS says how each provider's models are found; a provider
    // listAccounts can report but SUBSCRIPTIONS lacks fails listModels.test.ts.
    const groups = await Promise.all(accounts.map(async a => {
        const models = SUBSCRIPTIONS[a.provider];
        if (!models) return null;
        try { return { provider: a.provider, ids: (await models(ctx, a)).map(id => `${route(a.provider, a.account)}:${id}`) }; }
        catch { return null; /* this account cannot list now — the others still count */ }
    }));
    for (const g of groups) if (g?.ids.length) (out[g.provider] ??= []).push(...g.ids);

    // Other Hypers we relay through (docs/hyper-node.md): one group per node,
    // from the cached catalogue (refreshed at most every 5 minutes).
    if (!opts?.skipNodes) try {
        for (const node of await ctx.fns.node.list({})) {
            if (!node.enabled) continue;
            const fresh = await ctx.fns.node.refresh({ name: node.name, maxAgeMs: 5 * 60_000 }).catch(() => null);
            // A failed refresh must not resurrect a stale cached catalogue in a
            // creation picker: only a recent successful snapshot is callable.
            if (!fresh || fresh.lastError || !fresh.catalogAt || Date.now() - fresh.catalogAt > 5 * 60_000) continue;
            const catalog = fresh.catalog ?? [];
            if (catalog.length) out[`hyper/${node.name}`] = catalog.map((e) => `hyper/${node.name}:${e.id}`);
        }
    } catch { /* node tables absent (fresh db) — omit */ }
    return out;
}

// Claude subscription models. We cannot query an account-specific model catalogue from the Messages API, so
// every connected Claude source gets the current Anthropic aliases. Availability still depends on the plan and
// Anthropic policy; an unsupported choice fails clearly.
const CLAUDE_MODELS = [
    "claude-haiku-4-5",
    "claude-sonnet-4-5",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-opus-4-8",
    // Current Claude Platform aliases verified against Anthropic's live Models overview.
    "claude-opus-5",
    "claude-opus-5-5",
    "claude-fable-5",
    "claude-fable-5-1",
];

/**
 * How each subscription provider's models are found for one account: model ids without the route prefix.
 * Live catalogues ask the provider with that account's own credential (the whitelist is plan-gated, so two
 * accounts may differ) and skip accounts needing a reconnect; static ones list the known aliases and keep such
 * accounts visible so they can be picked and reconnected.
 */
const SUBSCRIPTIONS: Record<string, (ctx: Context, a: Account) => Promise<string[]>> = {
    codex: async (ctx, a) => {
        if (a.needsReconnect) return [];
        const tok = await ctx.fns.llm.refreshCodex({ account: a.account });
        if (!tok) return [];
        const version = await ctx.fns.llm.codexCliVersion({});
        const r = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(version)}`, {
            headers: { "authorization": `Bearer ${tok}`, "originator": "codex_cli_rs" },
            signal: AbortSignal.timeout(3000),
        });
        if (!r.ok) return [];
        const j: any = await r.json();
        return (j.models ?? [])
            .filter((m: any) => m.visibility !== "hidden" && m.visibility !== "hide" && m.supported_in_api !== false)
            .map((m: any) => String(m.slug));
    },
    // kimiCodingModels returns full routes (its own per-account cache); strip them back to ids.
    "kimi-coding": async (ctx, a) => a.needsReconnect ? [] : (await ctx.fns.llm.kimiCodingModels({ account: a.account })).map(id => id.slice(id.indexOf(":") + 1)),
    "claude-code": async () => CLAUDE_MODELS,
    "anthropic-oauth": async () => CLAUDE_MODELS,
    // SuperGrok / X Premium via xAI device OAuth: the current Grok Responses models.
    xai: async () => ["grok-4.6", "grok-4.5", "grok-4.3"],
};
