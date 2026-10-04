// What the quota indicator needs, in one query: every subscription credential
// we have a snapshot for, plus how many agents are currently parked on it.
/** Lists subscription quota snapshots with the parked-agent count per credential. */
/**
 * Collect the recorded quota of every subscription credential.
 *
 * Returns the worst of the two rolling windows per credential. Reads only the
 * small stored snapshot set; it never scans agents and never calls a provider.
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
        out.push({
            provider: snapshot.provider,
            account,
            label: account === "default" ? snapshot.provider : `${snapshot.provider} · ${account}`,
            model: `${snapshot.provider}${account === "default" ? "" : `/${account}`}:`,
            usedPercent,
            resetsAt: worst?.resetsAt ?? null,
            planType: snapshot.planType ?? null,
            resetCredits: snapshot.resetCredits ?? null,
            parkedAgents: 0,
            tone: usedPercent == null ? "neutral" : usedPercent >= alertAt ? "error" : usedPercent >= warnAt ? "warning" : "neutral",
            updatedAt: Number(snapshot.updatedAt ?? 0),
        } as const);
    }

    return out.sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1));
}
