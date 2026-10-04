/** Handles the llms usage GET HTTP route — the live subscription quota rings. */
export default async function (ctx: Context, _session: Session | null, _opts: {
    /** Incoming HTTP request. */
    req?: Request;
}) {
    // Never hold page rendering on provider I/O. One background refresh is
    // shared per process; every request immediately renders the latest durable
    // snapshots from the tiny kv set.
    const state = ((ctx.state as any).llmUsageRefresh ??= { promise: null, startedAt: 0 });
    if (!state.promise && Date.now() - Number(state.startedAt || 0) >= 60_000) {
        state.startedAt = Date.now();
        state.promise = ctx.fns.llm.refreshUsage({ maxAgeMs: 60_000 })
            .catch(() => undefined)
            .finally(() => { state.promise = null; });
    }

    const entries = await ctx.fns.llm.usageOverview({});
    // A live region rather than a poll: recordUsage runs on every LLM response,
    // so the watchdog interval only repairs a missed signal.
    const html = ctx.fns.ui.live({
        id: "llm-usage",
        url: "/llms/usage",
        topic: "llm-usage",
        every: 60,
        attrs: 'class="block"',
        html: ctx.fns.ui.usageDial({ entries }),
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
