/**
 * Points an open url, file or view canvas tab at another address in place
 *
 * For a url tab, re-checks the new address the same way canvas.show does (normalises it, checks whether the site allows framing). For a file tab, moves it to another file or directory (and Files view tab) after the same checks canvas.show makes. For a view tab, opens another `/rpc/<fn>?<json>` address of a `@view` function and keeps the tab's own history; url tabs keep one too, so `history: "back"` / `"forward"` step through the addresses a view or url tab has shown. Either way the tab keeps its position and gets a new title. Use for the address bar, for links clicked inside a tab, or when the person's current tab should show something else instead of opening a new tab.
 * @param opts.itemId Url, file or view tab to navigate (from canvas.list or canvas.show).
 * @param opts.url New address for a url tab (http/https, a bare host like example.com gets https://) or a view tab (`/rpc/<fn>?<json>`).
 * @param opts.file New target for a file tab: path (absolute or workspace-relative), host alias, and the Files view tab.
 * @param opts.history For a view or url tab: go to the previous or next address of its history instead of a new one.
 * @param opts.replace For a view tab: show the new address in place of the current one, without a history step — for a page changing its own filter, sort or selection. @default false
 * @param opts.agentId Agent whose canvas it is; defaults to the current agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Url, file or view tab to navigate (from canvas.list or canvas.show). */
        itemId: number;
        /** New address for a url tab (http/https, a bare host like example.com gets https://) or a view tab (`/rpc/<fn>?<json>`). */
        url?: string;
        /** New target for a file tab: path (absolute or workspace-relative), host alias, and the Files view tab. */
        file?: { path: string; host?: string; tab?: "" | "preview" | "code" | "edit" };
        /** For a view or url tab: go to the previous or next address of its history instead of a new one. */
        history?: "back" | "forward";
        /** For a view tab: show the new address in place of the current one, without a history step — for a page changing its own filter, sort or selection. @default false */
        replace?: boolean;
        /** Agent whose canvas it is; defaults to the current agent. */
        agentId?: string;
    },
): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const itemId = Number(opts.itemId);
    const current = (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId);
    if (!current) throw new Error(`canvas.navigate: no tab ${itemId} on ${agentId}'s canvas`);
    // A file link inside a view tab of files.page moves that tab to the other file (its address).
    if (opts.file && current.kind === "view") {
        const host = opts.file.host && opts.file.host !== "local" ? opts.file.host : undefined;
        const url = ctx.fns.rpc.url({ fn: "files.page", params: { path: opts.file.path, ...(host ? { host } : {}), ...(opts.file.tab ? { tab: opts.file.tab } : {}) } });
        return ctx.fns.canvas.navigate({ agentId, itemId, url, ...(opts.replace ? { replace: true } : {}) });
    }
    const target = opts.file ? "file" : current.kind === "view" ? "view" : "url";
    if (target !== current.kind) throw new Error(`canvas.navigate: tab ${itemId} is a ${current.kind} tab, not a ${target} tab`);
    if (opts.history && target === "file") throw new Error("canvas.navigate: history works on view and url tabs only");
    if (!opts.history && target !== "file" && !opts.url) throw new Error("canvas.navigate: url, file or history is required");
    const kind = ((ctx.state as any).canvas?.kinds ?? {})[target] as types.canvas.Registered | undefined;
    if (!kind?.prepare) throw new Error(`canvas.navigate: the ${target} kind is not loaded`);

    // A view or url tab remembers the addresses it showed: a new one pushes the current onto `back` and clears
    // `forward`; back/forward move one address between the two stacks. The stacks are tab state. For a url tab
    // "current" is where the person is inside the site (state.url, reported by the frames extension) if known.
    const sameUrl = (a: unknown, b: string) => { try { return new URL(String(a)).href === new URL(b).href; } catch { return false; } };
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    let back = list(current.state.back), forward = list(current.state.forward);
    let url = opts.url;
    if (target === "view" || target === "url") {
        const opened = String(current.args.url ?? "");
        const st = current.state ?? {};
        const here = target === "url" && typeof st.url === "string" && st.from === opened ? st.url : opened;
        if (opts.history === "back") { if (!back.length) return current; url = back.pop(); forward = [here, ...forward].slice(0, 50); }
        else if (opts.history === "forward") { if (!forward.length) return current; url = forward.shift(); back = [...back, here].slice(-50); }
        else if (!opts.replace && !(target === "url" && sameUrl(opts.url, here))) { back = [...back, here].slice(-50); forward = []; }
    }
    const args = opts.file ? { path: opts.file.path, host: opts.file.host, tab: opts.file.tab } : { url };
    const prepared = await kind.prepare(ctx, { agentId, args });
    if (target === "view" && !opts.history && prepared.args.url === current.args.url) return current;

    await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const row = (await ctx.fns.procs.db.select({ sql: "SELECT kind, state FROM canvas_items WHERE id = ? AND agent_id = ? AND closed_at IS NULL", params: [itemId, agentId] })) as any[];
            if (!row.length) throw new Error(`canvas.navigate: no tab ${itemId} on ${agentId}'s canvas`);
            const now = Date.now();
            // A url tab starts over at the new address: the site's last reported location no longer applies.
            const state = target === "view" ? JSON.stringify({ ...current.state, back, forward }) : target === "url" ? JSON.stringify({ back, forward }) : null;
            await ctx.fns.procs.db.run({
                sql: `UPDATE canvas_items SET payload = ?::jsonb, title = ?, updated_at = ?${state ? ", state = ?::jsonb" : ""} WHERE id = ?`,
                params: [JSON.stringify(prepared.args), String(prepared.title ?? "page").slice(0, 200), now, ...(state ? [state] : []), itemId],
            });
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
        },
    });
    return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}
