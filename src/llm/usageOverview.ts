// What the quota indicator needs, in one query: every subscription credential
// we have a snapshot for, plus how many agents are currently parked on it.
/** Lists subscription quota snapshots with the parked-agent count per credential. */
/**
 * Collect the recorded quota of every subscription credential.
 *
 * Returns the worst of the two rolling windows per credential — a 12% weekly
 * number is meaningless while the 5-hour one sits at 96% — together with the
 * number of agents parked on it. Reads only stored snapshots; never calls a
 * provider.
 *
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: {
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<Array<{
    provider: string;
    account: string;
    label: string;
    model: string;
    usedPercent: number | null;
    resetsAt: number | null;
    planType: string | null;
    resetCredits: types.llm.UsageSnapshot["resetCredits"];
    parkedAgents: number;
    tone: "neutral" | "warning" | "error";
    updatedAt: number;
}>> {
    const now = opts?.now ?? Date.now();
    // Thresholds are settings, not constants: how early "too much" starts
    // depends on the plan and on how the person works.
    const warnAt = Number(await ctx.fns.settings.getNumber({ module: "llm", scopeType: "global", key: "usageWarnPercent", fallback: 50 }));
    const alertAt = Number(await ctx.fns.settings.getNumber({ module: "llm", scopeType: "global", key: "usageAlertPercent", fallback: 75 }));
    const rows = (await ctx.fns.procs.db.select({
        sql: "SELECT key, value FROM kv WHERE key LIKE 'llm:usage:%'",
        params: [],
    })) as any[];

    const agents = (await ctx.fns.procs.db.select({
        sql: "SELECT model, scratchpad FROM agents WHERE archived_at IS NULL AND model IS NOT NULL",
        params: [],
    })) as any[];
    const parkedCount = new Map<string, number>();
    // Every subscription credential an agent actually uses deserves a place in
    // the indicator from the start. Waiting for the first recorded snapshot
    // means the panel is empty exactly when nothing has run yet — and stays
    // empty forever for a provider that reports no numbers at all.
    const seen = new Map<string, { provider: string; account: string; model: string }>();
    for (const row of agents) {
        const model = String(row.model ?? "");
        const parsed = splitModel(model);
        const kind = SUBSCRIPTION.has(parsed.provider);
        if (kind) seen.set(`${parsed.provider}:${parsed.account}`, { ...parsed, model });
        let parked: any = null;
        try { parked = JSON.parse(String(row.scratchpad ?? "{}"))?.parked ?? null; } catch { parked = null; }
        if (!parked?.provider) continue;
        const key = `${parked.provider}:${parked.account ?? "default"}`;
        parkedCount.set(key, (parkedCount.get(key) ?? 0) + 1);
    }

    const out = [];
    for (const row of rows) {
        let snapshot: types.llm.UsageSnapshot | null = null;
        try { snapshot = JSON.parse(String(row.value)); } catch { snapshot = null; }
        if (!snapshot?.provider) continue;

        // A window whose reset has passed is stale: the quota rolled over and
        // nothing has reported the new figure yet. Better to show nothing than
        // a number we know to be wrong.
        const fresh = (w?: types.llm.UsageWindow) => (w && (!w.resetsAt || w.resetsAt > now) ? w : undefined);
        const primary = fresh(snapshot.windows?.primary);
        const secondary = fresh(snapshot.windows?.secondary);
        const worst = [primary, secondary]
            .filter(Boolean)
            .sort((a, b) => (b!.usedPercent ?? 0) - (a!.usedPercent ?? 0))[0];

        const usedPercent = worst ? worst.usedPercent : null;
        const account = snapshot.account ?? "default";
        seen.delete(`${snapshot.provider}:${account}`);
        out.push({
            provider: snapshot.provider,
            account,
            label: account === "default" ? snapshot.provider : `${snapshot.provider} · ${account}`,
            model: modelOf(snapshot.provider, account, agents),
            usedPercent,
            resetsAt: worst?.resetsAt ?? null,
            planType: snapshot.planType ?? null,
            resetCredits: snapshot.resetCredits ?? null,
            parkedAgents: parkedCount.get(`${snapshot.provider}:${account}`) ?? 0,
            tone: usedPercent == null ? "neutral" : usedPercent >= alertAt ? "error" : usedPercent >= warnAt ? "warning" : "neutral",
            updatedAt: Number(snapshot.updatedAt ?? 0),
        } as const);
    }

    // Credentials in use but not yet measured: shown with an empty ring, so the
    // indicator is never a blank space with no explanation.
    for (const [key, info] of seen) {
        out.push({
            provider: info.provider,
            account: info.account,
            label: info.account === "default" ? info.provider : `${info.provider} · ${info.account}`,
            model: info.model,
            usedPercent: null,
            resetsAt: null,
            planType: null,
            resetCredits: null,
            parkedAgents: parkedCount.get(key) ?? 0,
            tone: "neutral",
            updatedAt: 0,
        } as const);
    }

    return out.sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1));
}

// Which providers own a quota at all. Pay-per-token keys have a balance, not a
// remaining percentage, and local models have neither.
const SUBSCRIPTION = new Set(["codex", "claude-code", "anthropic-oauth", "kimi-coding", "xai", "hyper"]);

function splitModel(model: string): { provider: string; account: string } {
    const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:/.exec(model);
    return { provider: m ? m[1]! : "lmstudio", account: m?.[2] ?? "default" };
}

// The ring shows a provider mark, and the mark is derived from a model string.
function modelOf(provider: string, account: string, agents: any[]): string {
    for (const row of agents) {
        const model = String(row.model ?? "");
        const parsed = splitModel(model);
        if (parsed.provider === provider && parsed.account === account) return model;
    }
    return `${provider}${account === "default" ? "" : `/${account}`}:`;
}
