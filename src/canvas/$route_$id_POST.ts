// POST /canvas/:id — open/close an agent's canvas or set the chat width beside it. JSON or form body:
// { op?: "toggleChat", open?: boolean, chatWidth?: number, chatCollapsed?: boolean, activeItemId?: number, closeItemId?: number, reopenItemId?: number,
// show?: { kind: "file" | "url", args }, navigate?: { itemId, url } | { itemId, file: { path, host?, tab? } } } — show opens a link clicked in the
// chat as a tab, navigate points a url tab at another address (its address bar) or a file tab at another file. Answers the
// resulting state with the panel fingerprint (rev).
/** Changes an agent's canvas state from the browser (canvas.update). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });
    const type = opts.req.headers.get("content-type") ?? "";
    let body: any = {};
    if (type.includes("application/json")) body = await opts.req.json().catch(() => ({}));
    else {
        const form = await opts.req.formData().catch(() => null);
        if (form?.has("open")) body.open = String(form.get("open"));
        if (form?.has("chatWidth")) body.chatWidth = String(form.get("chatWidth"));
        if (form?.has("chatCollapsed")) body.chatCollapsed = String(form.get("chatCollapsed"));
        if (form?.has("op")) body.op = String(form.get("op"));
        if (form?.has("activeItemId")) body.activeItemId = String(form.get("activeItemId"));
        if (form?.has("closeItemId")) body.closeItemId = String(form.get("closeItemId"));
        if (form?.has("reopenItemId")) body.reopenItemId = String(form.get("reopenItemId"));
    }
    const closeItemId = body.closeItemId == null || body.closeItemId === "" ? undefined : Number(body.closeItemId);
    const activeItemId = body.activeItemId == null || body.activeItemId === "" ? undefined : Number(body.activeItemId);
    if ((closeItemId !== undefined && !Number.isInteger(closeItemId)) || (activeItemId !== undefined && !Number.isInteger(activeItemId))) return new Response("invalid item id", { status: 400 });
    const reopenItemId = body.reopenItemId == null || body.reopenItemId === "" ? undefined : Number(body.reopenItemId);
    if (reopenItemId !== undefined && !Number.isInteger(reopenItemId)) return new Response("invalid item id", { status: 400 });
    if (closeItemId !== undefined) await ctx.fns.canvas.close({ agentId, itemId: closeItemId });
    if (reopenItemId !== undefined) {
        try { await ctx.fns.canvas.reopen({ agentId, itemId: reopenItemId }); }
        catch (error: any) { return new Response(String(error?.message ?? error), { status: 404 }); }
    }
    // A link clicked in the chat or opened as a new canvas tab from inside one (docs/canvas-links.md): only the
    // file, url and view kinds, whose prepare() checks the target — a browser request must not open arbitrary
    // kinds (html runs code, plugin kinds may read private data); a view is a `@view` address, read-only, and
    // rpc.render checks the person may call it. A site that forbids framing, asked with `fallback: "browser"`
    // (no frames extension in that browser), opens no tab: the answer says { browser: url } and the page opens it.
    // The chat header's inspector button: the agent's inspector page as a canvas tab (agent.inspector).
    if (body.op === "showInspector") {
        try { await ctx.fns.canvas.show({ agentId, kind: "view", args: { fn: "agent.inspector", params: { agentId } }, title: "Agent" }); }
        catch (error: any) { return new Response(String(error?.message ?? error), { status: 400 }); }
        body.open = true;
    }
    if (body.show && typeof body.show === "object") {
        const kind = String(body.show.kind ?? "");
        if (kind !== "file" && kind !== "url" && kind !== "view") return new Response("show: only file, url and view links open from a page", { status: 400 });
        const a = body.show.args ?? {};
        const tab = ["preview", "code", "edit"].includes(a.tab) ? a.tab : undefined;
        const args = kind === "file" ? { path: String(a.path ?? ""), ...(a.host ? { host: String(a.host) } : {}), ...(tab ? { tab } : {}) } : { url: String(a.url ?? "") };
        try {
            if (kind === "url" && body.show.fallback === "browser") {
                const urlKind = ((ctx.state as any).canvas?.kinds ?? {}).url as types.canvas.Registered | undefined;
                const checked = urlKind?.prepare ? await urlKind.prepare(ctx, { agentId, args }) : null;
                if (checked && checked.args.embeddable === false) return Response.json({ browser: String(checked.args.url) });
            }
            await ctx.fns.canvas.show({ agentId, kind, args });
        } catch (error: any) { return new Response(String(error?.message ?? error), { status: 400 }); }
        body.open = true;
    }
    // The address bar of a url tab: the same prepare() check as a new url tab, in place.
    if (body.navigate && typeof body.navigate === "object") {
        const itemId = Number(body.navigate.itemId);
        if (!Number.isInteger(itemId)) return new Response("invalid item id", { status: 400 });
        const f = body.navigate.file;
        const file = f && typeof f === "object" ? { path: String(f.path ?? ""), host: f.host ? String(f.host) : undefined, tab: (["preview", "code", "edit"].includes(f.tab) ? f.tab : "") as "" | "preview" | "code" | "edit" } : undefined;
        const history = body.navigate.history === "back" || body.navigate.history === "forward" ? body.navigate.history : undefined;
        const replace = body.navigate.replace === true;
        try { await ctx.fns.canvas.navigate({ agentId, itemId, ...(replace ? { replace } : {}), ...(file ? { file } : history ? { history } : { url: String(body.navigate.url ?? "") }) }); }
        catch (error: any) { return new Response(String(error?.message ?? error), { status: 400 }); }
    }
    const open = typeof body.open === "boolean" ? body.open : body.open === "1" || body.open === "true" ? true : body.open === "0" || body.open === "false" ? false : undefined;
    const chatWidth = body.chatWidth == null || body.chatWidth === "" ? undefined : Number(body.chatWidth);
    if (chatWidth !== undefined && !Number.isFinite(chatWidth)) return new Response("invalid chatWidth", { status: 400 });
    try {
        const chatCollapsed = typeof body.chatCollapsed === "boolean" ? body.chatCollapsed : body.chatCollapsed === "1" || body.chatCollapsed === "true" ? true : body.chatCollapsed === "0" || body.chatCollapsed === "false" ? false : undefined;
        const toggleChat = body.op === "toggleChat";
        const view = await ctx.fns.canvas.update({ agentId, open, chatWidth, chatCollapsed, activeItemId, ...(toggleChat ? { toggleChat } : {}) });
        // The header button posts with htmx and swaps nothing: every page of the chat (this one too) follows canvas.changed.
        if ((toggleChat || body.op === "showInspector") && opts.req.headers.get("hx-request") === "true") return new Response(null, { status: 204 });
        // A tab action from canvas.js asks for the new panel in the same answer (x-canvas-panel: 1): one round
        // trip instead of POST, then GET /panel, then the view's own fetch.
        const wantsPanel = opts.req.headers.get("x-canvas-panel") === "1";
        const [rev, panel] = await Promise.all([ctx.fns.canvas.revision({ agentId }), wantsPanel ? ctx.fns.canvas.panelHtml({ agentId }) : Promise.resolve(undefined)]);
        return Response.json({ ...view, rev: rev.panel, ...(panel !== undefined ? { panel } : {}) });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
}
