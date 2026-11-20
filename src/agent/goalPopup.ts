/**
 * Shows a chat's goal in the app popup: write what must be true, press Start, and the agent works until a checker agrees.
 *
 * Opened by the target icon in the message box (agent.goalBadge) or the Work card of the chat panel. Draws one text
 * field, what the goal is doing now (running, paused, reached, or why the checker stopped) and the buttons that fit
 * that state: Start for a goal that is not running, Save and Pause for a running one, Remove for any. Called with
 * `action` it changes the goal through agent.setGoal and answers an empty body, which closes the popup; a refused
 * action (an empty goal) draws the form again with the reason. Use agent.setGoal directly when no page is needed.
 * @param opts.agentId Chat whose goal is shown.
 * @param opts.action The pressed button: start (save and run), save (save, running or not as it was), pause (keep the goal, stop holding the agent to it), remove (delete it). Omit to only show the form.
 * @param opts.statement Goal text from the form, up to 2000 characters.
 * @param opts.iterations How many times a turn the checker may send the agent back. @default 3 @minimum 1 @maximum 10
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Chat whose goal is shown. */
        agentId: string;
        /** The pressed button: start (save and run), save (save, running or not as it was), pause (keep the goal, stop holding the agent to it), remove (delete it). Omit to only show the form. */
        action?: "start" | "save" | "pause" | "remove";
        /** Goal text from the form, up to 2000 characters. */
        statement?: string;
        /** How many times a turn the checker may send the agent back. @default 3 @minimum 1 @maximum 10 */
        iterations?: string | number;
    },
): Promise<Response> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const agentId = String(opts.agentId ?? "");
    const reply = (title: string, html: string) =>
        new Response(ctx.fns.ui.popupContent({ title, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return reply("Goal", `<p class="text-sm text-error">Not your chat.</p>`);
    const load = async () => (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    let agent = await load();
    if (!agent) return reply("Goal", `<p class="text-sm text-error">No chat ${esc(agentId)}.</p>`);

    let goal: any = agent.goal ?? null;
    let draft = opts.statement == null ? String(goal?.statement ?? "") : String(opts.statement);
    const iterations = Math.max(1, Math.min(10, Math.floor(Number(opts.iterations ?? goal?.maxIterations ?? 3)) || 3));
    let notice = "";
    if (opts.action) {
        const text = draft.trim();
        try {
            if (opts.action === "remove") await ctx.fns.agent.setGoal({ id: agentId, statement: "" });
            else if (opts.action === "pause") await ctx.fns.agent.setGoal({ id: agentId, statement: text || String(goal?.statement ?? ""), iterations, enabled: false });
            else if (!text) notice = "Write the goal first.";
            else await ctx.fns.agent.setGoal({ id: agentId, statement: text, iterations, enabled: opts.action === "start" || goal?.enabled === true });
            // Done: an empty answer closes the popup (ui/popup.js); the target icon and the chat show the result.
            if (!notice) return new Response("", { headers: { "content-type": "text/html; charset=utf-8" } });
        } catch (error: any) { notice = `Could not save: ${error?.message ?? error}`; }
        agent = await load();
        goal = agent?.goal ?? null;
    }

    const has = !!String(goal?.statement ?? "").trim();
    const running = has && goal.enabled === true;
    const status = String(goal?.status ?? "active");
    const last = Array.isArray(goal?.checks) ? goal.checks[goal.checks.length - 1] : null;
    const reason = last?.reason ? ` — ${String(last.reason).slice(0, 240)}` : "";
    // What the goal is doing now, in one line.
    const now = !has ? ""
        : running ? { dot: "running", text: last ? `Running. Last check: ${String(last.status).replace(/_/g, " ")}${reason}` : "Running. The checker looks each time the agent wants to stop." }
        : status === "achieved" ? { dot: "done", text: `Reached${reason}` }
        : status === "active" ? { dot: "idle", text: "Paused. Start to continue." }
        : { dot: "warning", text: `Stopped: ${status.replace(/_/g, " ")}${reason}` };
    const state = !has ? "new" : running ? "running" : status === "achieved" ? "reached" : status === "active" ? "paused" : "stopped";
    const button = (action: string, label: string, tone: "primary" | "ghost", title: string) =>
        w.button({ label, tone, size: "md", submit: { name: "action", value: action }, title, marks: { action: `goal-${action}` } });
    // One obvious next step first (⌘/Ctrl+Enter presses it — ui/rpc.js), the quiet ones after it.
    const buttons = running
        ? button("save", "Save", "primary", "Save the text; the goal keeps running — ⌘/Ctrl+Enter") + button("pause", "Pause", "ghost", "Keep the goal but stop holding the agent to it")
        : button("start", state === "new" ? "Start" : state === "paused" ? "Resume" : "Start again", "primary", "The agent starts working toward the goal now — ⌘/Ctrl+Enter") + button("save", "Save without starting", "ghost", "Keep the text for later");
    const steps = [...new Set([1, 2, 3, 5, 10, iterations])].sort((a, b) => a - b).map(String);
    const html = `<form hx-popup="agent.goalPopup" hx-popup-params='${esc(JSON.stringify({ agentId }))}' class="space-y-3" data-goal-state="${state}">
  <p class="text-xs leading-5 text-muted">Say what must be true when the work is done. The agent keeps going until a checker agrees it is.</p>
  ${w.textarea({ name: "statement", label: "Done when…", value: draft, rows: 4, maxlength: 2000, placeholder: "e.g. All tests pass and the fix is pushed to main" })}
  ${notice ? `<p class="text-xs text-error" role="alert">${esc(notice)}</p>` : ""}
  ${now ? `<p class="flex items-start gap-2 text-xs leading-5 text-muted" data-goal-now><span class="flex h-5 shrink-0 items-center">${w.dot({ state: now.dot as "idle" | "running" | "done" | "warning" })}</span><span class="min-w-0">${esc(now.text)}</span></p>` : ""}
  <div class="flex flex-wrap items-center gap-2">
    ${buttons}
    ${has ? button("remove", "Remove", "ghost", "Delete the goal") : ""}
    <label class="ml-auto flex items-center gap-1.5 text-xs text-muted" title="How many times in one turn the checker may send the agent back to work">up to ${w.select({ name: "iterations", options: steps, value: String(iterations), label: "Checks per turn" })} checks a turn</label>
  </div>
</form>`;
    return reply("Goal", html);
}
