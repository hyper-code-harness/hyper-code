/**
 * Prepare an expiring one-use Claude reset confirmation without spending a reset
 *
 * Fetch fresh eligibility for the exact local account and store a five-minute confirmation ticket for the provider-selected next usable grant. The ticket pins organization, grant, remaining uses and scope; confirming revalidates them. No reset POST is sent.
 * @param opts.provider Exact local Claude credential adapter.
 * @param opts.account Exact configured credential slot to display and later revalidate.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact local Claude credential adapter. */
        provider: "claude-code" | "anthropic-oauth";
        /** Exact configured credential slot to display and later revalidate. */
        account: string;
    },
): Promise<types.llm.ClaudeResetAttempt> {
    const state = await ctx.fns.llm.claudeResetStatus({provider:opts.provider, account:opts.account});
        const now = Date.now();
        const credit = state.resetCredits.credits?.find(c=>c.id===state.nextGrantId);
        if (state.resetCredits.availableCount == null || !credit || !credit.usableNow || !credit.remainingCount || typeof credit.expiresAt !== 'number' || credit.expiresAt <= now || (state.cooldownUntil != null && state.cooldownUntil > now)) throw new Error('No Claude reset is usable right now. Refresh accounts or check Claude usage.');
        const attempt: types.llm.ClaudeResetAttempt = {id:crypto.randomUUID(),provider:opts.provider,account:opts.account,organizationId:state.organizationId,grantId:credit.id,grantTitle:credit.title || 'Claude limit reset',clears:credit.description || '',remainingCount:credit.remainingCount,grantExpiresAt:credit.expiresAt,createdAt:now,expiresAt:Math.min(now+300000,credit.expiresAt),state:'prepared'};
        await ctx.fns.procs.db.run({sql:'INSERT INTO kv(key,value) VALUES (?,?)',params:['llm:claude-reset:attempt:'+attempt.id,JSON.stringify(attempt)]});
        return attempt;
}
