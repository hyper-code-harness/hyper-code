// Parse agent.model "provider:modelId" → {url, apiKey, modelId, provider, api}.
// "modelId" without prefix defaults to provider "lmstudio".
//
// An optional account segment selects WHICH credential of that provider to use:
// "codex/personal:gpt-5.6-sol". Omitted means account "default" — the historical
// single-credential behaviour, unchanged. Quota belongs to a subscription
// account, not to a provider, so parking and usage tracking key on both.
/** Performs the llm.resolveEndpoint runtime operation. */
/**
 * Parse agent.model "provider[/account]:modelId" into a callable endpoint.
 * @param opts.model Model identifier.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Model identifier to use. */ model: string }): Promise<{
    url: string;
    apiKey: string | null;
    modelId: string;
    provider: string;
    account: string;
    kind: "subscription" | "api" | "local";
    api: "openai" | "anthropic" | "responses" | "mock";
}> {
    const model = opts.model;
    const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:(.+)$/.exec(model);
    const provider = m ? m[1]! : "lmstudio";
    const account = (m?.[2] ?? "default");
    const modelId = m ? m[3]! : model;
    const p = PROVIDERS[provider];
    if (!p) throw new Error(`unknown provider: ${provider}`);

    // baseUrl + apiKey come from the provider's resolveBaseUrl/resolveApiKey,
    // which themselves consult declared settings (src/llm/$setting_*.ts).
    const baseUrl = await p.resolveBaseUrl(ctx);
    const apiKey = p.resolveApiKey ? await p.resolveApiKey(ctx, account) : null;
    const url = p.api === "anthropic" ? `${baseUrl}/v1/messages`
        : p.api === "responses" ? `${baseUrl}/responses`
            : `${baseUrl}/chat/completions`;
    return { url, apiKey, modelId, provider, account, kind: p.kind, api: p.api };
}

type ProviderConfig = {
    api: "openai" | "anthropic" | "responses" | "mock";
    // subscription = fixed quota per rolling window; a 429 means "wait until it
    // resets", money cannot fix it, so agents get parked. api = pay-per-token;
    // a 429 is short throttling and stays a normal retry. local = no limits.
    kind: "subscription" | "api" | "local";
    resolveBaseUrl: (ctx: Context) => string | Promise<string>;
    resolveApiKey?: (ctx: Context, account: string) => string | null | Promise<string | null>;
};

// Secret declarations contain either a provider reference (env://, op://) or a
// legacy literal. Resolution is centralized in the secrets namespace.
const declaredSecret = (key: string) => async (ctx: Context): Promise<string | null> => {
    return ctx.fns.secrets.resolveSetting({ module: 'llm', scopeType: 'global', key });
};

const declaredString = (key: string) => async (ctx: Context): Promise<string | null> => {
    const v = await ctx.fns.settings.getString({ module: 'llm', scopeType: 'global', key });
    return (typeof v === 'string' && v) ? v : null;
};

function decodeJwtExp(token: string): number | null {
    try {
        const payload = token.split(".")[1];
        if (!payload) return null;
        const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
        return typeof json.exp === "number" ? json.exp : null;
    } catch { return null; }
}

const PROVIDERS: Record<string, ProviderConfig> = {
    lmstudio: {
        api: "openai",
        kind: "local",
        // src/llm/$setting_lmstudioBaseUrl.ts handles env LMSTUDIO_URL → default.
        resolveBaseUrl: async (ctx) => ((await declaredString('lmstudioBaseUrl')(ctx)) ?? 'http://localhost:1234') + '/v1',
    },
    kimi: {
        // Moonshot-AI OpenAI-compat (NOT the kimi.com/coding subscription — use kimi-coding: for that)
        api: "openai",
        kind: "api",
        resolveBaseUrl: () => "https://api.moonshot.ai/v1",
        resolveApiKey: declaredSecret('kimiApiKey'),
    },
    "kimi-coding": {
        // Kimi coding subscription — Anthropic-messages protocol.
        // Token is read fresh from ~/.kimi/credentials/kimi-code.json on every
        // call (no caching). JWT exp is checked; expired tokens return null so
        // the caller fails loud instead of silently using a stale token.
        api: "anthropic",
        kind: "subscription",
        resolveBaseUrl: () => "https://api.kimi.com/coding",
        resolveApiKey: (ctx, account) => {
            if (account === "default" && ctx.env.KIMI_CODING_API_KEY) return ctx.env.KIMI_CODING_API_KEY;
            try {
                const { readFileSync } = require("node:fs");
                const { file } = ctx.fns.llm.accountCredentialPath({ provider: "kimi-coding", account });
                const raw = readFileSync(file!, "utf8");
                const j = JSON.parse(raw);
                const tok = j.access_token;
                if (!tok) return null;
                const exp = decodeJwtExp(tok);
                const now = Math.floor(Date.now() / 1000);
                if (exp && exp < now - 5) {
                    console.warn(`[kimi-coding] token expired ${now - exp}s ago — run \`kimi login\` to refresh`);
                    return null;
                }
                return tok;
            } catch (e: any) {
                console.warn(`[kimi-coding] cannot read credentials: ${e?.message}`);
                return null;
            }
        },
    },
    anthropic: {
        api: "anthropic",
        kind: "api",
        resolveBaseUrl: () => "https://api.anthropic.com",
        resolveApiKey: declaredSecret('anthropicApiKey'),
    },
    "claude-code": {
        // Anthropic subscription via the Claude Code CLI's keychain entry.
        // Token is fetched/refreshed in streamAnthropic at request time.
        api: "anthropic",
        kind: "subscription",
        resolveBaseUrl: () => "https://api.anthropic.com",
        resolveApiKey: () => null,
    },
    "anthropic-oauth": {
        // Managed Claude Pro/Max OAuth. Decryption + refresh happen lazily in
        // streamAnthropic, immediately before the request.
        api: "anthropic",
        kind: "subscription",
        resolveBaseUrl: () => "https://api.anthropic.com",
        resolveApiKey: () => null,
    },
    "claude-proxy": {
        // Another Hyper instance relays our Anthropic calls through ITS Claude
        // subscription (src/llm/$route_proxy_anthropic_v1_messages_POST.ts).
        // Same wire format and Claude Code identity as claude-code; the bearer is
        // the proxy token, refresh is the proxy host's business.
        api: "anthropic",
        kind: "subscription",
        resolveBaseUrl: async (ctx) => {
            const url = await declaredString("claudeProxyUrl")(ctx);
            if (!url) throw new Error("claude-proxy: CLAUDE_PROXY_URL is not configured");
            return url.replace(/\/$/, "");
        },
        resolveApiKey: declaredSecret("claudeProxyToken"),
    },
    xai: {
        // SuperGrok / X Premium subscription via xAI Device OAuth.
        // The access token is decrypted/refreshed lazily by streamXai.
        api: "responses",
        kind: "subscription",
        resolveBaseUrl: () => "https://api.x.ai/v1",
        resolveApiKey: () => null,
    },

    openai: {
        api: "openai",
        kind: "api",
        resolveBaseUrl: () => "https://api.openai.com/v1",
        resolveApiKey: declaredSecret('openaiApiKey'),
    },
    groq: {
        api: "openai",
        kind: "api",
        resolveBaseUrl: () => "https://api.groq.com/openai/v1",
        resolveApiKey: declaredSecret('groqApiKey'),
    },
    openrouter: {
        api: "openai",
        kind: "api",
        resolveBaseUrl: () => "https://openrouter.ai/api/v1",
        resolveApiKey: declaredSecret('openrouterApiKey'),
    },
    mock: {
        api: "mock",
        kind: "local",
        resolveBaseUrl: () => "mock://local",
    },
    codex: {
        // OpenAI ChatGPT subscription via Codex backend (Responses API).
        // Uses ~/.codex/auth.json (same file `codex` CLI maintains).
        // streamCodex() always re-asks refreshCodex() right before sending,
        // so an expired access_token here is fine — it gets refreshed there.
        api: "responses",
        kind: "subscription",
        resolveBaseUrl: () => "https://chatgpt.com/backend-api/codex",
        resolveApiKey: (ctx, account) => {
            try {
                const { readFileSync } = require("node:fs");
                const { file } = ctx.fns.llm.accountCredentialPath({ provider: "codex", account });
                const raw = readFileSync(file!, "utf8");
                return JSON.parse(raw)?.tokens?.access_token ?? null;
            } catch { return null; }
        },
    },
};
