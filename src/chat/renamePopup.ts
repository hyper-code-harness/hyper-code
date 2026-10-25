/**
 * Opens the rename form of a chat in the app popup (click on the chat name in the header).
 * @param opts.agentId Agent to rename.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent to rename. */
    agentId: string;
}): Promise<Response> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const id = String(opts.agentId ?? "");
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("agent not found", { status: 404 });
    const html = `<form hx-popup="chat.rename" hx-popup-params='${esc(JSON.stringify({ agentId: id }))}' class="space-y-3">
  <label class="block text-xs font-medium text-muted">Name<input name="title" value="${esc(agent.title ?? "")}" maxlength="120" autofocus class="mt-1 block w-full rounded-lg border border-ui-input bg-base-100 px-3 py-2 text-sm" placeholder="${esc(id)}"></label>
  ${ctx.fns.procs.ui.button({ action: "rename-chat", label: "Save", type: "submit", tone: "primary" })}
</form>`;
    return new Response(ctx.fns.ui.popupContent({ title: `Rename · ${agent.title || id}`, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
}
