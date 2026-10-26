/**
 * The background-jobs modal of a chat: the list of its bash / eval jobs (running first, then recent ones), or one
 * job with its full log when `id` is given. Opened from the jobs button in the chat header; a row opens its job in
 * the same modal, "← All jobs" goes back, Stop cancels a running one, Refresh re-reads the log.
 * @param opts.agentId Agent whose jobs to show.
 * @param opts.id Show this job with its log instead of the list.
 * @param opts.cancel Cancel this job first, then show it.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose jobs to show. */
    agentId: string;
    /** Show this job with its log instead of the list. */
    id?: string;
    /** Cancel this job first, then show it. */
    cancel?: string;
}): Promise<Response> {
    const esc = (text: unknown) => ctx.fns.procs.ui.escape({ text });
    const agentId = String(opts.agentId ?? "");
    const reply = (title: string, html: string) =>
        new Response(ctx.fns.ui.popupContent({ title, html, kind: "jobs" }), { headers: { "content-type": "text/html; charset=utf-8" } });
    // a link inside the modal: posts back to this function, the answer replaces the modal's body
    const go = (params: Record<string, unknown>, html: string, attrs = "") =>
        `<button type="button" hx-popup="jobs.panel" hx-popup-params='${esc(JSON.stringify({ agentId, ...params }))}' ${attrs}>${html}</button>`;
    const now = Date.now();
    // a running job's time ticks in the browser (ui/tool-timer.js counts .tool-row-clock from data-tool-started-at)
    const duration = (j: types.jobs.Job) => {
        const text = esc(ctx.fns.jobs.elapsed({ ms: j.status === "running" ? now - Number(j.startedAt ?? now) : Number(j.result?.ms ?? 0) }));
        return j.status === "running" ? `<span class="tool-timer tool-row-clock" data-tool-started-at="${Number(j.startedAt ?? now)}">${text}</span>` : text;
    };
    const badge = (j: types.jobs.Job) => {
        const [text, cls] = j.status === "running" ? ["running", "bg-primary/15 text-primary"]
            : j.status === "succeeded" ? ["exit 0", "bg-success/15 text-success"]
            : j.status === "failed" ? [`exit ${j.result?.exitCode ?? "?"}`, "bg-error/15 text-error"]
            : [j.status, "bg-base-300 text-muted"];
        return `<span class="shrink-0 rounded-full px-2 py-0.5 font-mono text-3xs ${cls}">${esc(text)}</span>`;
    };

    const focus = String(opts.cancel ?? opts.id ?? "");
    if (focus) {
        let job: types.jobs.Job;
        try { job = await ctx.fns.jobs.get({ id: focus }); } catch { return reply("Background jobs", `<p class="text-sm text-error">No job ${esc(focus)}.</p>`); }
        if (job.agentId !== agentId) return reply("Background jobs", `<p class="text-sm text-error">${esc(focus)} is not this chat's job.</p>`);
        let notice = "";
        if (opts.cancel && job.status === "running") {
            try { job = await ctx.fns.jobs.cancel({ id: job.id }); }
            catch (error: any) { notice = `<p class="text-xs text-error">${esc(error?.message ?? error)}</p>`; }
        }
        const log = await ctx.fns.jobs.logs({ id: job.id, offset: -200_000, limit: 200_000 }).catch(() => null);
        const text = (log?.text ?? job.result?.tail ?? "").replace(/\r(?!\n)/g, "\n");
        const cut = log && log.offset > 0 ? `<p class="text-3xs text-faint">Showing the last ${Math.round((log.bytes - log.offset) / 1024)} KB of ${Math.round(log.bytes / 1024)} KB.</p>` : "";
        const actions = [
            go({}, `<i class="ph ph-arrow-left" aria-hidden="true"></i> All jobs`, `class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs hover:bg-base-300"`),
            `<span class="ml-auto"></span>`,
            go({ id: job.id }, `<i class="ph ph-arrow-clockwise" aria-hidden="true"></i> Refresh`, `class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs hover:bg-base-300"`),
            job.status === "running" ? go({ cancel: job.id }, `<i class="ph ph-stop" aria-hidden="true"></i> Stop`, `class="inline-flex items-center gap-1 rounded-full bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20"`) : "",
        ].join("");
        return reply(`Job ${job.id}`, `<div class="flex h-full min-h-0 flex-col gap-2">
  <div class="flex items-center gap-1">${actions}</div>
  ${notice}
  <div class="flex items-center gap-2 text-xs">${badge(job)}<span class="text-faint">${duration(job)}${job.host ? ` · on ${esc(job.host)}` : ""} · started ${esc(new Date(Number(job.startedAt ?? job.createdAt)).toLocaleString("en-GB"))}</span></div>
  <pre class="whitespace-pre-wrap break-all font-mono text-xs text-base-content">${esc(job.title)}</pre>
  ${cut}
  <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-3xs leading-snug text-base-content">${text.trim() ? esc(text) : '<span class="text-faint">No output yet.</span>'}</pre>
</div>`);
    }

    const rows = (await ctx.fns.procs.db.select({
        sql: `(SELECT * FROM jobs WHERE agent_id = ? AND kind = 'exec' AND status = 'running' ORDER BY created_at DESC)
              UNION ALL
              (SELECT * FROM jobs WHERE agent_id = ? AND kind = 'exec' AND status <> 'running' ORDER BY finished_at DESC NULLS LAST LIMIT 30)`,
        params: [agentId, agentId],
    })) as any[];
    const jobs = rows.map(r => ctx.fns.jobs.fromRow({ row: r }));
    const running = jobs.filter(j => j.status === "running").length;
    const list = jobs.map(j => go({ id: j.id }, `
  <span class="flex w-full items-center gap-2">${badge(j)}<span class="min-w-0 flex-1 truncate font-mono text-xs text-base-content">${esc(j.title)}</span><span class="shrink-0 text-3xs text-faint">${duration(j)}</span><i class="ph ph-caret-right text-faint" aria-hidden="true"></i></span>`,
        `class="w-full rounded-lg border border-ui-border bg-base-100 px-3 py-2 text-left hover:border-primary/50" title="${esc(j.title)}"`)).join("");
    return reply(`Background jobs${running ? ` · ${running} running` : ""}`,
        jobs.length ? `<div class="flex flex-col gap-1.5">${list}</div>` : `<p class="text-sm text-muted">This chat has no background jobs.</p>`);
}
