/** Render the live Dock quota indicator without replacing its open account-details popover. */
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
        // Keep click/keyboard details stable, including a response already in flight.
        // Closing the popover lets the next usage signal or watchdog refresh normally.
        attrs: `hx-on::before:request="if (this.querySelector(':popover-open')) event.preventDefault()" hx-on::before:swap="if (this.querySelector(':popover-open')) event.preventDefault()"`,
        html: ctx.fns.ui.usageDial({ entries }),
    });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
