/**
 * Chat header button for the agent's background commands (bash / eval jobs): an icon with the number running,
 * opening jobs.panel. Hidden while nothing runs and nothing ran.
 *
 * A live region on the agent's topic: a job start or end refreshes it (jobs.start / jobs.finish), and while
 * something runs it re-checks every few seconds anyway.
 * @param opts.agentId Agent whose jobs to show.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose jobs to show. */
    agentId: string;
}): Promise<string> {
    const counts = ((await ctx.fns.procs.db.select({
        sql: "SELECT count(*) FILTER (WHERE status = 'running')::int AS running, count(*)::int AS total FROM jobs WHERE agent_id = ? AND kind = 'exec'",
        params: [opts.agentId],
    })) as any[])[0] ?? { running: 0, total: 0 };
    const running = Number(counts.running ?? 0);
    const label = running ? `${running} background job${running === 1 ? "" : "s"} running` : "Background jobs";
    const inner = Number(counts.total ?? 0) ? ctx.fns.ui.popup({
        method: "jobs.panel",
        params: { agentId: opts.agentId },
        html: `<i class="ph ph-terminal-window text-lg" aria-hidden="true"></i>${running
            ? `<span class="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-content">${running}</span>`
            : ""}`,
        attrs: `class="relative flex size-7 items-center justify-center rounded-full ${running ? "text-primary" : "text-subtle"} hover:bg-base-200 hover:text-base-content" title="${label}" aria-label="${label}"`,
    }) : "";
    return ctx.fns.ui.live({
        id: "jobs-button",
        url: `/jobs/${encodeURIComponent(opts.agentId)}/button`,
        topic: `agent:${opts.agentId}`,
        every: running ? 5 : 60,
        tag: "span",
        attrs: 'class="inline-flex"',
        html: inner,
    });
}
