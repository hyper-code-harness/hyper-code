/**
 * Finish a trusted attempt or ready logical call exactly once.
 *
 * Internal observer lifecycle helper. Attempts settle independently from logical operations; relay completion waits for a protocol terminal, body EOF, cancellation or error. Failed retries do not make an eventual successful logical operation fail.
 * @param opts.scope Internally minted logical scope owning this completion.
 * @param opts.attempt Internally minted attempt to finish, when an observer or SDK result completes.
 * @param opts.status Final attempt outcome; defaults to success when finishing an attempt.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Internally minted logical scope owning this completion. */
        scope: types.llmUsage.Scope;
        /** Internally minted attempt to finish, when an observer or SDK result completes. */
        attempt?: types.llmUsage.Attempt;
        /** Final attempt outcome; defaults to success when finishing an attempt. */
        status?: "success" | "error" | "cancelled";
    },
): Promise<void> {
    const st = await ctx.fns.llmUsage.getState({});
    const s=opts.scope, a=opts.attempt;
    if (!st.scopes.has(s)) return;
    if (a) {
        if (!st.attempts.has(a) || a.scope !== s || a.finalized) return;
        a.finalized=true; a.status=opts.status ?? "success"; a.finishedAt=Date.now();
        const tokens=[a.inputTokens,a.outputTokens,a.cacheReadTokens,a.cacheWriteTokens];
        a.usageState=tokens.every(n=>n!==null)?"known":tokens.some(n=>n!==null)?"partial":"unknown";
        s.active=Math.max(0,s.active-1); s.pendingAttempts?.delete(a);
        if (a.id === s.lastAttemptId) s.lastAttemptStatus=a.status;
        await ctx.fns.llmUsage.persist({scope:s,attempt:a});
    }
    if (s.finalized || !s.returned || s.active > 0) return;
    s.finalized=true; s.finishedAt=Date.now(); s.status=s.cancelled?"cancelled":s.failed?"error":(s.lastAttemptStatus ?? "success");
    await ctx.fns.llmUsage.persist({scope:s});
}
