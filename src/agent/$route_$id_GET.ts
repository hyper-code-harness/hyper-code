// GET /agent/:id — an agent is an ordinary application page. The global layout
// owns only the agents rail; this route owns the chat and its agent-specific
// side panel, so navigating to /llms or /files replaces the agent completely.
/** Handles the id get HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request;
        /** Values bound to the operation. */
params: Record<string, string> }) {
    const id = opts.params.id!;
    let agent = (ctx.state as any).agent?.[id];
    if (!agent) {
        agent = (await ctx.fns.session?.load?.({ id })) ?? null;
        if (agent) {
            (ctx.state as any).agent ??= {};
            (ctx.state as any).agent[id] = agent;
        }
    }
    if (!agent) return new Response("Not Found", { status: 404 });

    await ctx.fns.procs.db.run({
        sql: `INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        params: [`hot:${id}`, String(Date.now())],
    });
    const chat = await ctx.fns.ui.chatColumn({ agentId: id });
    const [canvas, canvasPanel] = await Promise.all([ctx.fns.canvas.get({ agentId: id }), ctx.fns.canvas.panelHtml({ agentId: id })]);
    // No inspector column: the agent's inspector is a page (agent.inspector) the header's ⓘ button opens as a canvas tab.
    // id="chat-panel" is the chat client's mount point: /agent/chat.js loads
    // once for the whole app and (re)binds itself to this element after every
    // swap — Enter-to-send, stick-to-bottom, older-message paging and the tool
    // cards all hang off it. Without the id the page renders and does nothing.
    // The canvas panel is always rendered; data-canvas-open shows it and narrows the chat to --chat-w
    // (src/canvas/$script_canvas.js flips it without re-rendering the chat).
    const main = `<div ${ctx.fns.w.marks({ page: "agent", id })} data-canvas-agent="${ctx.fns.w.escape({ text: id })}"${canvas.open ? " data-canvas-open" : ""}${canvas.chatCollapsed ? " data-chat-collapsed" : ""} style="--chat-w:${canvas.chatWidth}px" class="flex min-h-0 min-w-0 flex-1 bg-base-200">
  ${canvasPanel}
  <section id="chat-panel" data-agent-id="${ctx.fns.w.escape({ text: id })}" class="flex min-w-0 flex-1 flex-col">${chat}</section>
</div>`;

    return { currentId: id, title: agent.title || id, main };
}
