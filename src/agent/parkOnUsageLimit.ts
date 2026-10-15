// Parking: what to do when a subscription window is spent.
//
// The quota belongs to a credential, not to an agent — when one agent hits it,
// every other agent on the same provider+account is already out of quota too.
// Discovering that one failure at a time costs a wasted request and a red toast
// per agent, so the first failure parks the whole group at once.
//
// Parked is deliberately NOT an error state: nothing is broken, and there is
// nothing for the user to fix. The agent keeps its unread messages (the run
// cursor never advanced), gets a wake-up at the reset moment, and continues on
// its own. agent.deliverWakes then clears the mark.
/** Parks every agent sharing an exhausted subscription until its quota resets. */
/**
 * Park all agents that share an exhausted subscription credential.
 *
 * Marks each agent as parked, schedules a durable wake-up at the reset moment
 * with per-agent jitter, clears the pending run and emits one toast for the
 * whole group. Call it from the worker loop when llm.classifyError returns
 * kind "usage_limit".
 *
 * @param opts.info Failure classification produced by llm.classifyError.
 * @param opts.originAgentId Agent whose request hit the limit, for the toast.
 * @param opts.fallbackMs Parking duration when the provider gives no reset time.
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Classified failure; must have kind "usage_limit". */
        info: types.llm.FailureInfo;
        /** Id of the agent whose call hit the limit. */
        originAgentId?: string;
        /** How long to park when resetsAt is unknown, ms. @default 3600000 @minimum 60000 */
        fallbackMs?: number;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<{ provider: string; account: string; resetsAt: number; parked: string[] }> {
    const { info } = opts;
    if (info.kind !== "usage_limit") throw new Error(`parkOnUsageLimit: expected kind "usage_limit", got "${info.kind}"`);
    const now = opts.now ?? Date.now();
    const fallbackMs = Math.max(60_000, Number(opts.fallbackMs ?? 3_600_000));
    // A reset moment already in the past would refuse to schedule; treat it as
    // "soon" rather than failing to park at all.
    const resetsAt = info.resetsAt && info.resetsAt > now + 30_000 ? info.resetsAt : now + fallbackMs;

    const rows = (await ctx.fns.procs.db.select({
        sql: "SELECT id, model, wake_at, wake_reason FROM agents WHERE archived_at IS NULL AND model IS NOT NULL",
        params: [],
    })) as any[];

    const targets = rows.filter((row) => {
        const parsed = splitModel(String(row.model ?? ""));
        return parsed.provider === info.provider && parsed.account === info.account;
    });

    const reason = `${info.provider} usage limit resets — continue the interrupted work`;
    const parked: string[] = [];

    for (const row of targets) {
        const id = String(row.id);
        // Jitter: without it every agent of the group wakes in the same second
        // and hits the API simultaneously. A minute of slack also absorbs clock
        // skew and an imprecise resets_at.
        const at = resetsAt + 60_000 + (hash(id) % 240_000);
        try {
            const updated = await ctx.fns.session.mutateScratchpad({
                id,
                mutate: (scratchpad: Record<string, any>) => {
                    const already = scratchpad.parked ?? null;
                    scratchpad.parked = {
                        reason: "usage_limit",
                        provider: info.provider,
                        account: info.account,
                        model: String(row.model ?? ""),
                        planType: info.planType ?? null,
                        resetsAt,
                        wakeAt: at,
                        parkedAt: now,
                        message: info.message,
                        // Only one time alarm exists per agent; remember what we
                        // overwrote so unpark can put a user's own wake back.
                        // A repeat 429 after a premature wake must preserve the
                        // ORIGINAL user alarm, not remember our own parking wake
                        // as if it belonged to the user.
                        previousWake: already?.previousWake ?? (row.wake_at ? { at: Number(row.wake_at), reason: String(row.wake_reason ?? "") } : null),
                    };
                },
            });
            // Parking replaces the pending run and clears the error: this is a
            // wait, not a failure, and "send a message to retry" is bad advice.
            await ctx.fns.procs.db.run({
                sql: "UPDATE agents SET wake_at = ?, wake_reason = ?, next_run_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND archived_at IS NULL",
                params: [at, reason, now, id],
            });
            const live = (ctx.state as any).agent?.[id];
            if (live) {
                live.scratchpad = updated.scratchpad;
                live.wakeAt = at;
                live.wakeReason = reason;
            }
            await ctx.fns.session.appendEvent({
                id,
                event: {
                    type: "parked",
                    reason: "usage_limit",
                    provider: info.provider,
                    account: info.account,
                    planType: info.planType ?? null,
                    resetsAt,
                    wakeAt: at,
                    message: info.message,
                },
            });
            ctx.fns.events.refreshAgentMeta({ agentId: id, section: "wake", reason: "parked" });
            parked.push(id);
        } catch (error: any) {
            console.error(`parkOnUsageLimit: could not park ${id}:`, error?.message ?? error);
        }
    }

    // ONE toast for the group. Fourteen identical toasts is how the current
    // behaviour turns a single exhausted plan into noise.
    if (parked.length) {
        await ctx.fns.ui.notify({
            agentId: opts.originAgentId,
            level: "warn",
            message: `${info.provider}${info.account === "default" ? "" : `/${info.account}`}: limit reached — ${parked.length} agent(s) parked`,
            body: `${info.message}\nAgents will resume automatically: ${parked.join(", ")}`,
        }).catch(() => {});
    }

    // The quota indicator must show the wall too, not only the approach to it.
    await ctx.fns.llm.recordUsage({
        provider: info.provider,
        account: info.account,
        spent: true,
        resetsAt,
        planType: info.planType ?? null,
        now,
    }).catch(() => undefined);

    return { provider: info.provider, account: info.account, resetsAt, parked };
}

// "codex/personal:gpt-5.6-sol" → provider codex, account personal.
function splitModel(model: string): { provider: string; account: string } {
    const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:/.exec(model);
    return { provider: m ? m[1]! : "lmstudio", account: m?.[2] ?? "default" };
}

function hash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
}
