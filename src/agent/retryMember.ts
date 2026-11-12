/**
 * Resume a blocked or failed delegated child through the durable worker queue
 *
 * Validates direct team ownership, resumes the child plan timer, changes blocked or failed delegation status back to working, appends a focused retry instruction, and schedules the child durably. Use from Team after fixing the cause of a delegated failure or stop.
 * @param opts.agent Parent agent that owns the delegated child.
 * @param opts.member Blocked or failed direct child agent ID to retry.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parent agent that owns the delegated child. */
        agent: types.agent.Agent;
        /** Blocked or failed direct child agent ID to retry. */
        member: string;
    },
): Promise<{ retried: boolean; member: string }> {
    const member = String(opts.member ?? "").trim();
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT parent_id, archived_at, run_state, scratchpad FROM agents WHERE id = ?", params: [member] })) as any[];
    const row = rows[0];
    if (!row || String(row.parent_id ?? "") !== opts.agent.id || row.archived_at != null) throw new Error("retryMember: member is not an active direct child");
    if (String(row.run_state ?? "idle") !== "idle") throw new Error("retryMember: member is busy");
    const scratchpad = typeof row.scratchpad === "string" ? JSON.parse(row.scratchpad) : (row.scratchpad ?? {});
    const meta = scratchpad.delegation ?? scratchpad.delegateTask;
    if (!meta || !["blocked", "failed"].includes(String(meta.status))) throw new Error("retryMember: member is not blocked or failed");
    const now = Date.now();
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: member, mutate: (next: Record<string, any>) => {
      const delegation = next.delegation ?? next.delegateTask; delegation.status = "working"; delegation.summary = null; delegation.retriedAt = now;
      const plan = next.plan; if (plan?.pausedAt) { plan.pausedAt = null; delete plan.pauseReason; delete plan.pauseNote; plan.updatedAt = now; const active = plan.tasks?.find((task: any) => task.status === "active"); if (active && !active.activeSince) active.activeSince = now; }
    } });
    const child = (ctx.state as any).agent?.[member]; if (child) child.scratchpad = updated.scratchpad;
    await ctx.fns.session.appendUserMessage({ id: member, text: "Parent requested a retry. Resume the active plan task, address the previous stop or failure, and complete the remaining plan." });
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND run_state = 'idle' AND archived_at IS NULL", params: [now, now, member] });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: opts.agent.id, section: "team", reason: "team-retry" });
    return { retried: true, member };
}
