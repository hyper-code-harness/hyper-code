/**
 * Opens the background jobs of a chat in the app popup: running ones with a live clock, the tail of their log and
 * Stop, then the recent finished ones with their exit code; `id` shows one job with its full log.
 *
 * Opened by the jobs badge next to the chat's Stop button. Only bash/eval jobs (kind exec) are listed; wake-ups,
 * crons and watches are not. Stop cancels the job without messaging the agent. Refused for a chat the signed-in
 * person may not see (jobs.canSee).
 * @param opts.agentId Agent (chat) whose jobs are shown.
 * @param opts.id Show this job with its full log instead of the list.
 * @param opts.stop Cancel this running job first, then show the list.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent (chat) whose jobs are shown. */
    agentId: string;
    /** Show this job with its full log instead of the list. */
    id?: string;
    /** Cancel this running job first, then show the list. */
    stop?: string;
}): Promise<Response> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const agentId = String(opts.agentId ?? "");
    const reply = (title: string, html: string) =>
        new Response(ctx.fns.ui.popupContent({ title, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return reply("Background jobs", `<p class="text-sm text-error">Not your chat.</p>`);

    const mine = async (id: string) => {
        const job = await ctx.fns.jobs.get({ id }).catch(() => null);
        return job && job.agentId === agentId && job.kind === "exec" ? job : null;
    };
    let notice = "";
    if (opts.stop) {
        const job = await mine(String(opts.stop));
        if (!job) notice = `No job ${esc(opts.stop)} in this chat.`;
        else if (job.status === "running") {
            try { await ctx.fns.jobs.cancel({ id: job.id }); notice = `Stopped ${esc(job.id)}.`; }
            catch (error: any) { notice = `Could not stop ${esc(job.id)}: ${esc(error?.message ?? error)}`; }
        }
    }

    const open = (params: Record<string, string>) => ({ popup: { method: "jobs.popup", params: { agentId, ...params } } });
    const status = (j: types.jobs.Job) => j.status === "running"
        ? w.badge({ text: "running", tone: "info" })
        : j.status === "succeeded" ? w.badge({ text: "exit 0", tone: "success" })
        : j.status === "failed" ? w.badge({ text: `exit ${j.result?.exitCode ?? "?"}`, tone: "danger" })
        : w.badge({ text: j.status, tone: "neutral" });
    const secs = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round(ms / 1000) % 60).padStart(2, "0")}s`;
    const time = (j: types.jobs.Job) => j.status === "running" ? w.timer({ since: Number(j.startedAt ?? j.createdAt) }) : esc(secs(Number(j.result?.ms ?? 0)));
    const pre = (text: string) => `<pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-base-200 p-2 font-mono text-3xs">${esc(text.replace(/\r(?!\n)/g, "\n").trimEnd() || "(no output yet)")}</pre>`;
    const stopBtn = (j: types.jobs.Job) => w.button({ label: "Stop", icon: "stop", size: "sm", tone: "danger", action: { ...open({ stop: j.id }), confirm: `Stop ${j.id}?` }, marks: { action: "stop", entity: "job", id: j.id } });
    const head = (j: types.jobs.Job) => `<div class="flex items-center gap-2 text-xs">${status(j)}<span class="text-faint">${time(j)}${j.host ? ` · on ${esc(j.host)}` : ""}</span><span class="font-mono text-3xs text-faint">${esc(j.id)}</span></div>
<div class="truncate font-mono text-xs" title="${esc(j.title)}">${esc(j.title)}</div>`;

    if (opts.id) {
        const job = await mine(String(opts.id));
        if (!job) return reply("Background jobs", `<p class="text-sm text-error">No job ${esc(opts.id)} in this chat.</p>`);
        const log = await ctx.fns.jobs.logs({ id: job.id, offset: -200_000, limit: 200_000 }).catch(() => null);
        const cut = log && log.offset > 0 ? `<p class="text-3xs text-faint">Last ${Math.round((log.bytes - log.offset) / 1024)} KB of ${Math.round(log.bytes / 1024)} KB.</p>` : "";
        const actions = [w.button({ label: "All jobs", icon: "arrow-left", size: "sm", tone: "ghost", action: open({}) }),
            w.button({ label: "Refresh", icon: "arrow-clockwise", size: "sm", tone: "ghost", action: open({ id: job.id }) }),
            job.status === "running" ? stopBtn(job) : ""].join("");
        return reply(`Job ${job.id}`, `<div class="flex flex-col gap-2"><div class="flex items-center gap-1">${actions}</div>${head(job)}${cut}${pre(log?.text ?? job.result?.tail ?? "").replace("max-h-48", "max-h-[60vh]")}</div>`);
    }

    const all = (await ctx.fns.jobs.list({ agentId, status: "all", limit: 60 })).filter((j) => j.kind === "exec");
    const running = all.filter((j) => j.status === "running");
    const done = all.filter((j) => j.status !== "running").slice(0, 8);
    const tails = await Promise.all(running.map((j) => ctx.fns.jobs.logs({ id: j.id, offset: -600, limit: 600 }).then((l) => l.text.replace(/\r(?!\n)/g, "\n").trimEnd().split("\n").pop() ?? "").catch(() => "")));
    // A process table like Activity Monitor / top: state, id, time, command, last output line, kill.
    const row = (j: types.jobs.Job, last?: string) => {
        const live = j.status === "running";
        const state = live ? w.dot({ state: "running" }) : j.status === "succeeded" ? "0" : j.status === "failed" ? String(j.result?.exitCode ?? "?") : j.status;
        const kill = live ? w.iconButton({ icon: "x", label: `Kill ${j.id}`, tone: "danger", size: 24, action: { ...open({ stop: j.id }), confirm: `Kill ${j.id}?` }, marks: { action: "stop", entity: "job", id: j.id } }) : "";
        return `<tr${live ? "" : " data-done"}><td>${state}</td><td>${w.pressable({ html: esc(j.id), action: open({ id: j.id }), title: "Open the log" })}</td><td data-num>${time(j)}</td><td data-grow title="${esc(j.title)}">${esc(j.title)}</td><td data-grow data-quiet title="${esc(last ?? "")}">${esc(live ? last ?? "" : j.result?.tail?.trimEnd().split("\n").pop() ?? "")}</td><td>${kill}</td></tr>`;
    };
    const rows = [...running.map((j, i) => row(j, tails[i])), ...done.map((j) => row(j))].join("");
    const body = `${notice ? `<p class="mb-2 text-xs text-muted">${notice}</p>` : ""}${all.length
        ? `<table class="w-procs"><thead><tr><th>S</th><th>ID</th><th data-num>Time</th><th>Command</th><th>Output</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="text-sm text-muted">Nothing ran in the background in this chat.</p>`}`;
    return reply(running.length ? `Background jobs · ${running.length} running` : "Background jobs", body);
}
