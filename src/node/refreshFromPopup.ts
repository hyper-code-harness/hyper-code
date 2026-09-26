/**
 * Refresh a node's catalogue and usage from the card and report the result
 * @param opts.name Node name.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Node name. */ name: string }): Promise<string> {
    const esc = (x: any) => ctx.fns.procs.ui.escape({ text: String(x ?? "") });
    const node = await ctx.fns.node.refresh({ name: opts.name });
    ctx.fns.procs.events.refresh({ topic: "node-clients", reason: "refresh" });
    const msg = !node ? "node not found" : node.lastError ? `Error: ${node.lastError}` : `${node.catalog?.length ?? 0} models, usage for ${node.usage?.length ?? 0} providers.`;
    return ctx.fns.ui.popupContent({ title: `hyper/${opts.name}`, kind: "login", html: `<p class="text-sm ${node?.lastError ? "text-error" : "text-success"}">${esc(msg)}</p>` });
}
