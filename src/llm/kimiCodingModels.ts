/**
 * Discover and cache the authenticated Kimi Coding subscription model catalogue.
 *
 * Use for the model picker, not Moonshot API models. Calls the same Bearer-authenticated coding/v1/models endpoint as kimi-cli. Per-account singleflight caches successful results for one minute; transient failures retain the last good list with exponential retry cooldown up to five minutes. Missing credentials and HTTP 401/403 clear availability. No inference requests or credential logging.
 * @param opts.account Credential account passed unchanged to refreshKimiCode; cached independently from other accounts. @default default
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Credential account passed unchanged to refreshKimiCode; cached independently from other accounts. @default default */
        account?: string;
    },
): Promise<string[]> {
    const account = opts.account ?? "default";
        type Entry = { value: string[]; nextAt: number; failures: number; pending?: Promise<string[]> };
        const state = ctx.state as typeof ctx.state & { kimiCodingModelCatalog?: Record<string, Entry> };
        const cache = state.kimiCodingModelCatalog ??= Object.create(null) as Record<string, Entry>;
        const entry = cache[account] ??= { value: [], nextAt: 0, failures: 0 };
        if (entry.pending) return entry.pending;
        if (Date.now() < entry.nextAt) return [...entry.value];
        const prefix = account === "default" ? "kimi-coding:" : "kimi-coding/" + account + ":";
        const refresh = async (): Promise<string[]> => {
            try {
                const key = await ctx.fns.llm.refreshKimiCode({ account });
                if (!key) { entry.value = []; throw new Error("credentials unavailable"); }
                // Official kimi-cli auth/platforms.py: _list_models uses this URL and Bearer header.
                const response = await fetch("https://api.kimi.com/coding/v1/models", {
                    headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(5000),
                });
                if (response.status === 401 || response.status === 403) entry.value = [];
                if (!response.ok) throw new Error("catalogue request failed");
                const body: unknown = await response.json();
                if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) throw new Error("invalid catalogue");
                const ids: string[] = [];
                for (const item of body.data) {
                    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim() || item.id !== item.id.trim() || /[\s:]/.test(item.id)) throw new Error("invalid model identifier");
                    ids.push(prefix + item.id);
                }
                entry.value = [...new Set(ids)];
                entry.failures = 0;
                entry.nextAt = Date.now() + 60_000;
            } catch {
                // Expected network/auth failures: no secrets, response bodies or per-request logs.
                entry.failures = Math.min(entry.failures + 1, 5);
                entry.nextAt = Date.now() + Math.min(300_000, 30_000 * 2 ** (entry.failures - 1));
            }
            return [...entry.value];
        };
        entry.pending = refresh().finally(() => { entry.pending = undefined; });
        return entry.pending;
}
