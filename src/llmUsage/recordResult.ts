/**
 * Record one completed SDK provider attempt using actual reported token counts.
 *
 * Call once with the final SDK result, not both incremental and aggregate usage. Requires an active trusted run; JSON RPC callers outside a run cannot forge ledger rows. Input token counts must be noncached input, and absent counters remain null. SDK cancellation is recorded distinctly from error.
 * @param opts.provider Actual SDK provider identifier selected by code.
 * @param opts.account Actual SDK account identifier, not a credential value.
 * @param opts.model Actual SDK model identifier selected by code.
 * @param opts.api SDK execution marker for non-HTTP attempt accounting.
 * @param opts.usage Actual SDK-reported noncached input, output, cache-read and cache-write counts; no estimates.
 * @param opts.status Final SDK attempt outcome; defaults to success. @default success
 * @param opts.startedAt SDK attempt start timestamp in Unix milliseconds, when available.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Actual SDK provider identifier selected by code. */
        provider: string;
        /** Actual SDK account identifier, not a credential value. */
        account: string;
        /** Actual SDK model identifier selected by code. */
        model: string;
        /** SDK execution marker for non-HTTP attempt accounting. */
        api: "sdk";
        /** Actual SDK-reported noncached input, output, cache-read and cache-write counts; no estimates. */
        usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
        /** Final SDK attempt outcome; defaults to success. @default success */
        status?: "success" | "error" | "cancelled";
        /** SDK attempt start timestamp in Unix milliseconds, when available. */
        startedAt?: number;
    },
): Promise<void> {
    try {
        const a=await ctx.fns.llmUsage.beginAttempt({provider:opts.provider,account:opts.account,model:opts.model,api:opts.api,startedAt:opts.startedAt});
        if(!a) return;
        if(!a.remote && opts.usage) for(const key of ["inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens"] as const) {
            const value=opts.usage[key];
            if(typeof value==="number" && Number.isSafeInteger(value) && value>=0) a[key]=value;
        }
        await ctx.fns.llmUsage.settle({scope:a.scope,attempt:a,status:opts.status??"success"});
    } catch { /* SDK results must survive failures of optional accounting. */ }
}
