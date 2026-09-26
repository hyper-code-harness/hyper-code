/**
 * Save (add/update) or remove a Hyper node from the edit popup and report the result
 * @param opts.name Node name.
 * @param opts.url Node base URL.
 * @param opts.token Token; empty keeps the stored one.
 * @param opts.remove Set to remove the node instead.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Node name. */ name: string; /** Node URL. */ url?: string; /** Token. */ token?: string; /** Remove flag. */ remove?: string | boolean }): Promise<string> {
    const esc = (x: any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const done = (msg: string, tone: "success" | "error") => { ctx.fns.procs.events.refresh({ topic: "node-clients", reason: "node" }); ctx.fns.procs.events.refresh({ topic: "llm-accounts", reason: "node" }); return ctx.fns.ui.popupContent({ title: "Hyper node", kind: "login", html: `<p class="text-sm ${tone === "error" ? "text-error" : "text-success"}">${esc(msg)}</p>` }); };
    try {
        if (opts.remove) { await ctx.fns.node.remove({ name: opts.name }); return done(`Removed hyper/${opts.name}.`, "success"); }
        const node = await ctx.fns.node.add({ name: opts.name, url: String(opts.url ?? ""), token: opts.token });
        return done(`hyper/${node.name}: ${node.catalog?.length ?? 0} models available.`, "success");
    } catch (e: any) { return done(String(e?.message ?? e), "error"); }
}
