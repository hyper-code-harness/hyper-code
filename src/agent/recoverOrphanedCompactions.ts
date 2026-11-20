/**
 * Clears interrupted compaction drafts, respecting live maintenance leases
 *
 * Recover idle agents after a process restart or a revoked maintenance lease. Queued drafts are fenced by their job token, including same-process lease expiry; legacy immediate drafts retain the process-owner check. A fresh transactional recheck prevents recovery from clearing a renewed or replacement attempt.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ recovered: string[] }> {
    const owner = ((ctx.state as any).compactionOwner ??= crypto.randomUUID());
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, sleep_context FROM agents WHERE archived_at IS NULL AND run_state = 'idle' AND sleep_context IS NOT NULL AND sleep_context->>'draftRevision' IS NOT NULL", params: [] }) as any[];
    const recovered: string[] = [];
    for (const row of rows) {
      const sleep: any = ctx.fns.agent.normalizeSleepContext({ sleepContext: row.sleep_context });
      const revision = sleep?.draftRevision;
      if (revision == null) continue;
      const draft = sleep.generations.find((g: any) => Number(g.revision) === Number(revision));
      if (!draft?.jobId && sleep?.draftOwner === owner) continue;
      const generations = (sleep.generations ?? []).map((g: any) => Number(g.revision) === Number(revision) ? { ...g, status: "failed", error: "compaction owner disappeared during restart" } : g);
      const next = { ...sleep, draftRevision: null, draftOwner: null, generations };
      const changed = await ctx.fns.procs.db.transaction({ fn: async () => {
        await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id=? FOR UPDATE", params:[row.id] });
        if (draft?.jobId) {
          const job = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL FOR UPDATE", params:[draft.jobId,draft.jobToken,Date.now()] }))[0];
          if (job) return { changes:0 };
        }
        return await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context=?::jsonb, updated_at=? WHERE id=? AND run_state='idle' AND sleep_context=?::jsonb", params: [JSON.stringify(next), Date.now(), row.id, JSON.stringify(row.sleep_context)] });
      } }) as { changes:number };
      if (changed.changes) { recovered.push(String(row.id)); const live=(ctx.state as any).agent?.[row.id]; if(live) live.sleepContext=next; await ctx.fns.session.appendEventWithHtml({ id:String(row.id), type:"compaction_failed", payload:{ revision, error:"recovered after interrupted Hyper process" } }).catch(()=>undefined); }
    }
    return { recovered };
}
