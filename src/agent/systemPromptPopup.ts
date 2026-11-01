/**
 * The chat panel's System prompt popup: which named base prompt the chat runs on, and a picker to switch it.
 *
 * Opened from the Context card. Without `name` it shows the current prompt, the choices and their text; with
 * `name` it switches the chat (agent.setSystemPrompt) and shows the result. The switch applies from the next turn.
 * @param opts.agentId Chat whose system prompt is shown or switched.
 * @param opts.name Switch the chat to this prompt first.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Chat whose system prompt is shown or switched. */
    agentId: string;
    /** Switch the chat to this prompt first. */
    name?: string;
}): Promise<Response> {
    const esc = (s: unknown) => ctx.fns.w.escape({ text: s });
    const id = String(opts.agentId ?? "");
    const reply = (html: string) => new Response(ctx.fns.ui.popupContent({ title: "System prompt", html }), { headers: { "content-type": "text/html; charset=utf-8" } });
    let notice = "";
    if (opts.name) {
        try { await ctx.fns.agent.setSystemPrompt({ id, name: String(opts.name) }); notice = `<p class="text-xs text-success">Switched to ${esc(opts.name)}. It applies from the next turn.</p>`; }
        catch (error: any) { notice = `<p class="text-xs text-error">${esc(error?.message ?? error)}</p>`; }
    }
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return reply(`<p class="text-sm text-error">No chat ${esc(id)}.</p>`);
    const base = await ctx.fns.agent.systemPromptBase({ agent });
    const prompts = await ctx.fns.agent.systemPrompts({ agentId: id });
    const current = base.source === "custom" ? "__custom" : base.name;
    const options = prompts.map(p => `<option value="${esc(p.name)}"${p.name === current ? " selected" : ""}>${esc(p.title)}${p.source === "builtin" ? "" : p.source === "project" ? " · project" : " · mine"} · ${p.tokens.toLocaleString("en-US")}t</option>`).join("")
        + (current === "__custom" ? `<option value="" selected disabled>Own text given at creation</option>` : "");
    const missing = base.missing ? `<p class="text-xs text-warning">"${esc(base.missing)}" no longer exists; the chat runs on full.</p>` : "";
    return reply(`<form hx-popup="agent.systemPromptPopup" hx-popup-params='${esc(JSON.stringify({ agentId: id }))}' class="space-y-3">
${notice}${missing}
<p class="text-sm">This chat runs on <b>${esc(base.source === "custom" ? "own text" : base.name)}</b>. Switching restarts the provider's prompt cache once.</p>
<select name="name" class="select select-bordered w-full bg-base-100">${options}</select>
<div>${ctx.fns.w.button({ label: "Switch", tone: "primary", size: "md", submit: true, marks: { action: "switch-system-prompt" } })}</div>
<details class="rounded-md border border-base-300"><summary class="cursor-pointer px-3 py-2 text-sm">Current text · ${Math.ceil(base.text.length / 4).toLocaleString("en-US")}t</summary><pre class="max-h-96 overflow-auto border-t border-base-300 bg-base-200 p-3 text-2xs whitespace-pre-wrap">${esc(base.text)}</pre></details>
</form>`);
}
