/**
 * Run one logical LLM operation with isolated fail-open accounting.
 *
 * Wrap only explicit model execution paths. Nested runs share the outer logical call; disabled and mock runs execute exactly once without body observation. Callbacks cannot be supplied through JSON RPC. Remote Hyper calls retain logical visibility without local token expenditure. Recording waits at most 150 milliseconds per database write.
 * @param opts.operation Logical execution operation, not an individual retry.
 * @param opts.requestedModel Code-resolved requested model route; mock routes bypass accounting.
 * @param opts.agentId Explicit local agent ID; otherwise inferred from the injected session.
 * @param opts.source Origin category: local model execution or terminal node relay. @default local
 * @param opts.clientId Authenticated incoming node client ID; never copy request claims.
 * @param opts.clientName Authenticated incoming node client safe label; never copy request claims.
 * @param opts.remote Mark remote Hyper execution as visibility-only, excluding local provider token expenditure. @default false
 * @param opts.fn Trusted in-process execution callback, invoked exactly once even if accounting fails.
 */
export default async function <T>(
    ctx: Context,
    session: Session | null,
    opts: {
        /** Logical execution operation, not an individual retry. */
        operation: "call" | "stream" | "compact" | "relay";
        /** Code-resolved requested model route; mock routes bypass accounting. */
        requestedModel?: string;
        /** Explicit local agent ID; otherwise inferred from the injected session. */
        agentId?: string;
        /** Origin category: local model execution or terminal node relay. @default local */
        source?: "local" | "node";
        /** Authenticated incoming node client ID; never copy request claims. */
        clientId?: string;
        /** Authenticated incoming node client safe label; never copy request claims. */
        clientName?: string;
        /** Mark remote Hyper execution as visibility-only, excluding local provider token expenditure. @default false */
        remote?: boolean;
        /** Trusted in-process execution callback, invoked exactly once even if accounting fails. */
        fn: () => Promise<T>;
    },
): Promise<T> {
    if (typeof opts.fn !== "function") throw new TypeError("Usage run requires an in-process callback");
    let st: types.llmUsage.State | undefined;
    let s: types.llmUsage.Scope | undefined;
    try {
        st=await ctx.fns.llmUsage.getState({});
        if (!st.storage?.getStore() && !/^mock[/:]/.test(opts.requestedModel??"")) {
            if (Date.now() >= st.enabledUntil && !st.checking) {
                st.checking=true;
                const state=st;
                let timer: ReturnType<typeof setTimeout> | undefined;
                const check=Promise.resolve().then(()=>ctx.fns.settings.get({module:"llmUsage",scopeType:"global",key:"enabled"})).then(value=>value===true || value==="true",()=>false).finally(()=>{state.checking=false;});
                state.enabledCheck=Promise.race([check,new Promise<false>(resolve=>{timer=setTimeout(()=>resolve(false),150);})]).then(value=>{
                    if(timer) clearTimeout(timer);
                    state.enabled=value; state.enabledUntil=Date.now()+1000;
                    return value;
                });
            }
            if(st.enabledCheck) await st.enabledCheck;
            if(st.enabled) {
                const safe=async(value:string|null|undefined)=>await ctx.fns.llmUsage.safeLabel({value});
                s={id:crypto.randomUUID(),agentId:await safe(opts.agentId ?? session?.agentId ?? session?.agent?.id),clientId:await safe(opts.clientId),clientName:await safe(opts.clientName),requestedModel:await safe(opts.requestedModel),source:opts.source??"local",operation:opts.operation,remote:opts.remote??/^hyper[/:]/.test(opts.requestedModel??""),startedAt:Date.now(),finishedAt:null,status:"pending",active:0,returned:false,failed:false,cancelled:false,finalized:false,persisted:false,broken:false};
                st.scopes.add(s);
                await ctx.fns.llmUsage.persist({scope:s});
            }
        }
    } catch { s=undefined; /* Setup errors must not prevent the one provider execution below. */ }
    if(!s || !st?.storage) return await opts.fn();
    const scope=s;
    return await st.storage.run(scope,async()=>{
        try {
            const result = await opts.fn();
            if (scope.operation === "relay" && result instanceof Response && !result.ok) scope.failed=true;
            return result;
        }
        catch(error) {
            scope.failed=true; scope.cancelled=error instanceof Error && error.name==="AbortError";
            // A consumer can abandon a response without cancelling its reader. Close metadata only;
            // never read or cancel its bytes here. Later usage is deliberately unknown after abandonment.
            try {
                await Promise.all([...(scope.pendingAttempts ?? [])].map(attempt=>ctx.fns.llmUsage.settle({scope,attempt,status:scope.cancelled?"cancelled":"error"})));
            } catch { /* Preserve the exact provider/consumer error even if optional cleanup fails. */ }
            throw error;
        }
        finally {
            scope.returned=true;
            try { await ctx.fns.llmUsage.settle({scope}); }
            catch { /* Finalization must not replace a provider result or exception. */ }
        }
    });
}
