/**
 * Observe one actual provider HTTP submission inside a logical usage run.
 *
 * Wrap only adapter model-generation fetch calls, not model discovery or usage requests. Calls send exactly once. Outside an active enabled run this is a transparent bypass. Attempts retain actual provider/account/model identifiers; retries require separate fetch invocations. Failure of accounting never retries a provider request.
 * @param opts.provider Actual provider selected by code for this physical send.
 * @param opts.account Actual credential account identifier; never a secret value.
 * @param opts.model Actual wire model selected by code for this physical send.
 * @param opts.api Wire protocol whose usage frames should be observed.
 * @param opts.send Trusted in-process network callback invoked exactly once.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Actual provider selected by code for this physical send. */
        provider: string;
        /** Actual credential account identifier; never a secret value. */
        account: string;
        /** Actual wire model selected by code for this physical send. */
        model: string;
        /** Wire protocol whose usage frames should be observed. */
        api: "anthropic" | "responses" | "openai";
        /** Trusted in-process network callback invoked exactly once. */
        send: () => Promise<Response>;
    },
): Promise<Response> {
    if(typeof opts.send!=="function") throw new TypeError("Usage fetch requires an in-process callback");
    let attempt:types.llmUsage.Attempt|null=null;
    try { attempt=await ctx.fns.llmUsage.beginAttempt({provider:opts.provider,account:opts.account,model:opts.model,api:opts.api}); }
    catch { attempt=null; /* Accounting must never prevent the real submission. */ }
    let response:Response;
    try { response=await opts.send(); }
    catch(error) {
        if(attempt) { try { await ctx.fns.llmUsage.settle({scope:attempt.scope,attempt,status:error instanceof Error && error.name==="AbortError"?"cancelled":"error"}); } catch { /* Preserve the original provider exception. */ } }
        throw error;
    }
    if(!attempt) return response;
    try { return await ctx.fns.llmUsage.observe({response,attempt}); }
    catch { /* Response observer construction failed: return the untouched provider response when possible. */
        try { await ctx.fns.llmUsage.settle({scope:attempt.scope,attempt,status:response.ok?"success":"error"}); } catch { /* Preserve provider response. */ }
        return response;
    }
}
