// Return models grouped by provider-prefix.
// LM Studio is queried live; remote providers return a small curated static list.
// Missing/unreachable providers are omitted silently.
/** Performs the llm.listModels runtime operation. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<Record<string, string[]>> {
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

    // Remote curated defaults (prefixed with provider: so you copy-paste the model string directly)
    out.kimi = [
        "kimi:kimi-k3",
        "kimi:kimi-k2.5",
        "kimi:kimi-k2-thinking-turbo",
        "kimi:kimi-k2-thinking",
    ];
    // Kimi CLI subscription models. These use the Anthropic-compatible coding
    // endpoint and OAuth token managed by `kimi-cli` under ~/.kimi.
    out["kimi-coding"] = [
        "kimi-coding:k3",
        "kimi-coding:k3-256k",
        "kimi-coding:kimi-for-coding",
        "kimi-coding:kimi-for-coding-highspeed",
    ];
    out.openai = [
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
    } catch { /* missing/invalid key or unreachable — use fallback */ }
    if (!out.groq) {
        out.groq = [
            "groq:openai/gpt-oss-120b",
            "groq:openai/gpt-oss-20b",
            "groq:llama-3.3-70b-versatile",
            "groq:llama-3.1-8b-instant",
        ];
    }
    out.openrouter = [
        "openrouter:anthropic/claude-sonnet-4.6",
        "openrouter:google/gemini-2.5-pro",
    ];

    // xAI subscription catalogue. Device OAuth currently exposes the current
    // Grok Responses models; actual availability remains account/plan-specific.
    try {
        const status = await ctx.fns.llm.xaiOAuthStatus?.({});
        if (status?.connected) out.xai = [
            "xai:grok-4.6",
            "xai:grok-4.5",
            "xai:grok-4.3",
        ];
    } catch { /* OAuth migration unavailable / not connected — omit */ }


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
                    .filter((m: any) => m.visibility !== "hidden" && m.supported_in_api !== false)
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
            const usable = (managed.accounts ?? []).filter((entry: any) => !entry.needsReconnect);
            out["anthropic-oauth"] = usable.flatMap((entry: any) => {
                const account = String(entry.account ?? "default");
                const prefix = account === "default" ? "anthropic-oauth" : `anthropic-oauth/${account}`;
                return claudeModels.map(id => `${prefix}:${id}`);
            });
        }
    } catch { /* migration unavailable / not connected — omit */ }

    return out;
}
