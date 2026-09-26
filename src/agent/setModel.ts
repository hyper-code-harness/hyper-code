// Changing the model of a LIVE agent — previously impossible: the model was
// fixed at creation, so an exhausted subscription left the only choice of
// waiting. This is the manual half of the parking story: switch model, or
// switch to another credential of the same provider, and continue now.
/** Switches a running agent to another model or credential account. */
/**
 * Point an existing agent at a different model, provider or credential account.
 *
 * Validates the target through llm.resolveEndpoint (unknown provider or a
 * missing key fails here rather than on the next request), records a visible
 * transcript event, and lifts a usage-limit parking so the interrupted work
 * resumes immediately on the new model.
 *
 * @param opts.id Agent whose model changes.
 * @param opts.model Target model as "provider[/account]:modelId".
 * @param opts.scope Apply to this agent only, or to every agent sharing its parked credential.
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Target model string, e.g. "kimi-coding:k3" or "codex/personal:gpt-5.6-sol". */
        model: string;
        /** "agent" changes one agent; "provider" changes every agent parked on the same credential. @default "agent" */
        scope?: "agent" | "provider";
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<{ changed: string[]; model: string; from: string | null }> {
    const model = String(opts.model ?? "").trim();
    const now = opts.now ?? Date.now();
    if (!model) throw new Error("setModel: model is required");

    // Fail here, loudly, instead of on the agent's next turn.
    const endpoint = await ctx.fns.llm.resolveEndpoint({ model });
    if (!endpoint.apiKey && endpoint.kind !== "local" && endpoint.provider !== "claude-code" && endpoint.provider !== "anthropic-oauth") {
        throw new Error(`setModel: no credential for ${endpoint.provider}/${endpoint.account} — add a key or log in first`);
    }

    const row = ((await ctx.fns.procs.db.select({
        sql: "SELECT id, model, scratchpad FROM agents WHERE id = ? AND archived_at IS NULL",
        params: [opts.id],
    })) as any[])[0];
    if (!row) throw new Error(`setModel: agent not found: ${opts.id}`);
    const from = row.model ? String(row.model) : null;

    let targets = [String(row.id)];
    if (opts.scope === "provider") {
        // "Move everyone off the credential that ran out" — the common case when
        // a whole group of agents was parked by one exhausted plan.
        let parked: any = null;
        try { parked = JSON.parse(String(row.scratchpad ?? "{}"))?.parked ?? null; } catch { parked = null; }
        if (parked?.provider) {
            const rows = (await ctx.fns.procs.db.select({
                sql: "SELECT id, model FROM agents WHERE archived_at IS NULL AND model IS NOT NULL",
                params: [],
            })) as any[];
            targets = rows
                .filter((r) => {
                    const parsed = splitModel(String(r.model ?? ""));
                    return parsed.provider === parked.provider && parsed.account === (parked.account ?? "default");
                })
                .map((r) => String(r.id));
            if (!targets.includes(String(row.id))) targets.push(String(row.id));
        }
    }

    const changed: string[] = [];
    for (const id of targets) {
        const before = ((await ctx.fns.procs.db.select({ sql: "SELECT model FROM agents WHERE id = ?", params: [id] })) as any[])[0];
        const previous = before?.model ? String(before.model) : null;
        const live = (ctx.state as any).agent?.[id];
        // The live object is what the next turn reads. A row edited behind the
        // process (SQL, migration) can already say the new model while the agent
        // in memory still runs the old one — that drift is exactly a switch.
        if (previous === model && (!live || live.model === model)) continue;
        // The last error belonged to the old model; leaving it makes the status
        // bar keep shouting about a credential the agent no longer uses.
        await ctx.fns.procs.db.run({
            sql: "UPDATE agents SET model = ?, last_error = NULL, updated_at = ? WHERE id = ? AND archived_at IS NULL",
            params: [model, now, id],
        });
        const liveBefore = live?.model ?? previous;
        if (live) live.model = model;
        await ctx.fns.session.appendEvent({ id, event: { type: "model_changed", from: liveBefore, to: model } }).catch(() => undefined);
        // A new model means a new quota. If lifting the parking fails, roll the
        // model back and fail the operation — returning success with a new
        // model but an old wake/park mark strands the unanswered work.
        try {
            await ctx.fns.agent.unpark({ id, reason: "model-switch", now });
        } catch (error) {
            await ctx.fns.procs.db.run({
                sql: "UPDATE agents SET model = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
                params: [previous, Date.now(), id],
            }).catch(() => undefined);
            if (live) live.model = previous;
            throw error;
        }
        ctx.fns.events.refreshAgentMeta({ agentId: id, section: "wake", reason: "model-changed" });
        changed.push(id);
    }
    if (changed.length) { try { ctx.fns.events.emitAgentsChanged({}); } catch {} }

    return { changed, model, from };
}

function splitModel(model: string): { provider: string; account: string } {
    const m = /^([a-z][\w\-]*)(?:\/([\w\-.]+))?:/.exec(model);
    return { provider: m ? m[1]! : "lmstudio", account: m?.[2] ?? "default" };
}
