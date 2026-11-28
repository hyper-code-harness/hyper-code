/**
 * Mint one metadata-only provider attempt inside an active logical usage scope.
 *
 * Internal adapter helper. No active scope means no accounting; untrusted reconstructed scope identities are never accepted. Safe labels only; remote attempts never contain provider expenditure tokens.
 * @param opts.provider Actual code-resolved provider identifier, not request text.
 * @param opts.account Actual resolved account identifier, never a token or credential.
 * @param opts.model Actual wire model identifier selected by the adapter.
 * @param opts.api Wire protocol or SDK used by this physical submission.
 * @param opts.startedAt SDK attempt start timestamp in Unix milliseconds, when available.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Actual code-resolved provider identifier, not request text. */
        provider: string;
        /** Actual resolved account identifier, never a token or credential. */
        account: string;
        /** Actual wire model identifier selected by the adapter. */
        model: string;
        /** Wire protocol or SDK used by this physical submission. */
        api: "anthropic" | "responses" | "openai" | "sdk";
        /** SDK attempt start timestamp in Unix milliseconds, when available. */
        startedAt?: number;
    },
): Promise<types.llmUsage.Attempt | null> {
    const st=await ctx.fns.llmUsage.getState({});
    const s=st.storage?.getStore();
    if(!s || !st.scopes.has(s) || s.finalized || s.broken) return null;
    const safe=async(value:string)=>await ctx.fns.llmUsage.safeLabel({value});
    const a:types.llmUsage.Attempt={id:crypto.randomUUID(),scope:s,provider:await safe(opts.provider),account:await safe(opts.account),model:await safe(opts.model),api:opts.api,remote:/^hyper(?:[/:]|$)/.test(opts.provider),startedAt:Number.isSafeInteger(opts.startedAt)&&opts.startedAt!>=0?opts.startedAt!:Date.now(),finishedAt:null,status:"pending",httpStatus:null,inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,usageState:"unknown",finalized:false,persisted:false};
    st.attempts.add(a); (s.pendingAttempts ??= new Set()).add(a); s.active++; s.lastAttemptId=a.id; s.lastAttemptStatus=undefined;
    await ctx.fns.llmUsage.persist({scope:s,attempt:a});
    return a;
}
