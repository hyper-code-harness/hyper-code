/**
 * Returns the id of the person on whose behalf the current call runs, or null.
 *
 * Uses the signed-in user on the session; for background work without a user (worker, cron,
 * wake) falls back to the creator of the given agent, so the run counts as that person's.
 * Recording only — this is not an access check.
 * @param opts.agentId Agent whose creator is the fallback author.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose creator is the fallback author. */
        agentId?: string;
    },
): Promise<string | null> {
    const fromSession = (session as any)?.user?.id;
    if (fromSession) return String(fromSession);
    if (!opts?.agentId) return null;
    const live = (ctx.state as any).agent?.[opts.agentId];
    if (live?.createdBy) return String(live.createdBy);
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [opts.agentId] }) as any[];
    return rows[0]?.created_by ?? null;
}
