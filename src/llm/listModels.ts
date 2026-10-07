// Return models grouped by provider-prefix.
// LM Studio is queried live; remote providers return a small curated static list.
// Missing/unreachable providers are omitted silently.
/**
 * List models per provider, including hyper/<node> groups from configured nodes.
 * @param opts.skipNodes Omit hyper/<node> groups and do not refresh node catalogues (host-side catalogue building). @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: { /** Omit node groups. @default false */ skipNodes?: boolean }): Promise<Record<string, string[]>> {
    // The catalogue asks LM Studio, Groq, every Hyper node and each provider's credentials — seconds of
    // work that the model popup and the new-chat form used to wait for on every open. The last answer is
    // returned at once and refreshed in the background once it is a minute old; only the very first call
    // (or a test with a fresh ctx) waits.
    const key = opts?.skipNodes ? "skipNodes" : "all";
    if (!(ctx as any).state) return build(ctx, opts);
    const cache: Record<string, { at: number; value?: Record<string, string[]>; pending?: Promise<Record<string, string[]>> }> =
        ((ctx.state as any).llmModelCatalog ??= {});
    const entry = (cache[key] ??= { at: 0 });
    const refresh = () => entry.pending ??= build(ctx, opts)
        .then(value => { entry.value = value; entry.at = Date.now(); return value; })
        .finally(() => { entry.pending = undefined; });
    if (!entry.value) return refresh();
    if (Date.now() - entry.at > 60_000) refresh().catch(() => undefined);
    return entry.value;
}

async function build(ctx: Context, opts?: { skipNodes?: boolean }): Promise<Record<string, string[]>> {
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
    // The subscription catalogue is discovered independently of Moonshot API models.
    const codingModels = await ctx.fns.llm.kimiCodingModels({});
    if (codingModels.length) out["kimi-coding"] = codingModels;
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

    // xAI subscription catalogue. Emit account-qualified routes for named
    // credential slots so new agents do not silently fall back to "default".
    try {
        const status = await ctx.fns.llm.xaiOAuthStatus?.({});
        if (status?.connected) {
            const models = ["grok-4.6", "grok-4.5", "grok-4.3"];
            const accounts = Array.isArray(status.accounts)
                ? status.accounts.filter((entry: any) => !entry.needsReconnect)
                : [{ account: "default" }];
            out.xai = accounts.flatMap((entry: any) => {
                const account = String(entry.account ?? "default");
                const prefix = account === "default" ? "xai" : `xai/${account}`;
                return models.map(id => `${prefix}:${id}`);
            });
        }
    } catch { /* OAuth migration unavailable / not connected — omit */ }

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


    // Codex (ChatGPT subscription) — only if user has a valid JWT.
    // Models pulled live from /codex/models (subscription-gated whitelist).
    try {
        const tok = await ctx.fns.llm.refreshCodex?.({});
        if (tok) {
            const version = await ctx.fns.llm.codexCliVersion({});
            const url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(version)}`;
            const r = await fetch(url, {
                headers: { "authorization": `Bearer ${tok}`, "originator": "codex_cli_rs" },
                signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
                const j: any = await r.json();
                const ids = (j.models ?? [])
                    .filter((m: any) => m.visibility !== "hidden" && m.visibility !== "hide" && m.supported_in_api !== false)
                    .map((m: any) => `codex:${m.slug}`);
                if (ids.length) out.codex = ids;
            }
        }
    } catch { /* not logged in or unreachable — omit */ }

    // Claude subscription models. We cannot query an account-specific model
    // catalogue from the Messages API, so expose the current Anthropic aliases
    // for every connected subscription source. Availability still depends on
    // the user's plan and Anthropic policy; an unsupported choice fails clearly.
    const claudeModels = [
        "claude-haiku-4-5",
        "claude-sonnet-4-5",
        "claude-sonnet-4-6",
        "claude-sonnet-5",
        "claude-opus-4-5",
        "claude-opus-4-6",
        "claude-opus-4-8",
        // Current Claude Platform aliases verified against Anthropic's live
        // Models overview. Availability remains account/plan-specific.
        "claude-opus-5",
        "claude-opus-5-5",
        "claude-fable-5",
        "claude-fable-5-1",
    ];
    try {
        const tok = await ctx.fns.llm.refreshClaudeCode?.({});
        if (tok) out["claude-code"] = claudeModels.map(id => `claude-code:${id}`);
    } catch { /* no keychain access — omit */ }

    try {
        const managed = await ctx.fns.llm.anthropicOAuthStatus?.({});
        if (managed?.connected) {
            const accounts = managed.accounts ?? [];
            out["anthropic-oauth"] = accounts.flatMap((entry: any) => {
                const account = String(entry.account ?? "default");
                const prefix = account === "default" ? "anthropic-oauth" : `anthropic-oauth/${account}`;
                return claudeModels.map(id => `${prefix}:${id}`);
            });
        }
    } catch { /* migration unavailable / not connected — omit */ }

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
