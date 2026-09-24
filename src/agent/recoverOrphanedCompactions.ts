/**
 * Clears compaction drafts owned by a previous Hyper process
 *
 * Scan idle agents for durable compaction drafts whose process owner differs from the current runtime, mark those generations failed, and clear draftRevision so compaction and agent work can resume after a crash or restart. Safe to call repeatedly from the worker loop.
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
      if (revision == null || sleep?.draftOwner === owner) continue;
      const generations = (sleep.generations ?? []).map((g: any) => Number(g.revision) === Number(revision) ? { ...g, status: "failed", error: "compaction owner disappeared during restart" } : g);
      const next = { ...sleep, draftRevision: null, draftOwner: null, generations };
      const changed = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context=?::jsonb, updated_at=? WHERE id=? AND run_state='idle' AND sleep_context->>'draftRevision'=? AND COALESCE(sleep_context->>'draftOwner','')=?", params: [JSON.stringify(next), Date.now(), row.id, String(revision), String(sleep.draftOwner ?? "")] });
      if (changed.changes) { recovered.push(String(row.id)); const live=(ctx.state as any).agent?.[row.id]; if(live) live.sleepContext=next; await ctx.fns.session.appendEventWithHtml({ id:String(row.id), type:"compaction_failed", payload:{ revision, error:"recovered after interrupted Hyper process" } }).catch(()=>undefined); }
    }
    return { recovered };
}
