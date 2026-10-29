/**
 * Opens the subagents of a chat in the app popup: each delegated child with its state, plan progress, current task
 * and last summary, a link to its chat and Stop for the ones still working.
 *
 * Opened by the robot badge in the chat input. Lists direct team children (agent.team), working ones first, then up
 * to 8 finished ones. Stop goes through agent.stopMember (the child is marked blocked and the parent is told). Refused
 * for a chat the signed-in person may not see (jobs.canSee).
 * @param opts.agentId Parent agent (chat) whose subagents are shown.
 * @param opts.stop Stop this working child first, then show the list.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Parent agent (chat) whose subagents are shown. */
    agentId: string;
    /** Stop this working child first, then show the list. */
    stop?: string;
}): Promise<Response> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const agentId = String(opts.agentId ?? "");
    const reply = (title: string, html: string) =>
        new Response(ctx.fns.ui.popupContent({ title, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return reply("Subagents", `<p class="text-sm text-error">Not your chat.</p>`);
    const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    if (!agent) return reply("Subagents", `<p class="text-sm text-error">No chat ${esc(agentId)}.</p>`);

    let notice = "";
    if (opts.stop) {
        try { await ctx.fns.agent.stopMember({ agent, member: String(opts.stop) }); notice = `Stopped ${esc(opts.stop)}.`; }
        catch (error: any) { notice = `Could not stop ${esc(opts.stop)}: ${esc(error?.message ?? error)}`; }
    }

    const team = await ctx.fns.agent.team({ agent });
    const working = (m: (typeof team)[number]) => m.status === "working" || m.runState === "running";
    const open = (params: Record<string, string>) => ({ popup: { method: "agent.teamPopup", params: { agentId, ...params } } });
    // One compact row per child, like the sidebar: its chat icon, title, what it does now, progress and a state dot;
    // the row opens its chat, Stop sits at the end of a working one.
    const times = new Map(((await ctx.fns.procs.db.select({ sql: "SELECT id, created_at FROM agents WHERE parent_id = ?", params: [agentId] })) as Array<{ id: string; created_at: number }>).map((r) => [String(r.id), Number(r.created_at)]));
    // A process table like Activity Monitor / top: state, id, time, name, current task, progress, kill.
    const row = (m: (typeof team)[number]) => {
        const tasks: any[] = Array.isArray(m.plan?.tasks) ? m.plan.tasks : [];
        const done = tasks.filter((t) => t.status === "done").length;
        const active = tasks.find((t) => t.status === "active");
        const live = working(m);
        const since = times.get(m.id) ?? 0;
        const state = live ? w.dot({ state: "running" }) : m.status === "failed" || m.status === "blocked" ? w.dot({ state: "error" }) : w.dot({ state: "done" });
        const what = live ? (active?.title ?? "working") : `${m.status}${m.summary ? ` · ${m.summary}` : ""}`;
        const time = live && since ? w.timer({ since }) : esc(m.updatedAt && since ? short(m.updatedAt - since) : "");
        const kill = live ? w.iconButton({ icon: "x", label: `Stop ${m.title || m.id}`, tone: "danger", size: 24, action: { ...open({ stop: m.id }), confirm: `Stop ${m.title || m.id}?` }, marks: { action: "stop", entity: "agent", id: m.id } }) : "";
        return `<tr${live ? "" : " data-done"}><td>${state}</td><td><a href="/agent/${encodeURIComponent(m.id)}" title="Open the chat">${esc(m.id)}</a></td><td data-num>${time}</td><td data-grow title="${esc(m.title)}">${esc(m.title || m.id)}</td><td data-grow data-quiet title="${esc(what)}">${esc(what)}</td><td data-num>${tasks.length ? `${done}/${tasks.length}` : ""}</td><td>${kill}</td></tr>`;
    };
    const short = (ms: number) => ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round(ms / 1000) % 60).padStart(2, "0")}s`;
    const live = team.filter(working);
    const rest = team.filter((m) => !working(m)).slice(-8).reverse();
    const body = `${notice ? `<p class="mb-2 text-xs text-muted">${notice}</p>` : ""}${team.length
        ? `<table class="w-procs"><thead><tr><th>S</th><th>ID</th><th data-num>Time</th><th>Name</th><th>Doing</th><th data-num>Plan</th><th></th></tr></thead><tbody>${[...live, ...rest].map(row).join("")}</tbody></table>`
        : `<p class="text-sm text-muted">No subagents in this chat.</p>`}`;
    return reply(live.length ? `Subagents · ${live.length} working` : "Subagents", body);
}
